/* Copyright:		© 2012 by Vitaly Gordon (rocket.mind@gmail.com)
 * Licensed under:	MIT
 */

var debug = false

Life = _.extends (Viewport, {
	init: function () {
		_.extend (this, {
			/* shaders */
			randomNoiseShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-random-noise-fs',
				attributes: ['position'],
				uniforms: ['seed', 'seed2', 'seed3', 'screenSpace', 'gridSize']
			}),
			updateProgramShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'update-program-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'screenSpace', 'rules', 'forkRules', 'pixelOffset', 'numStates', 'numSymbols', 'seed', 'lifeDecrease']
			}),
			moveTapeShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'move-tape-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'screenSpace', 'pixelOffset']
			}),
			parametricBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-brush-fs',
				attributes: ['position'],
				uniforms: ['cells',
					'brushPosition1', 'brushPosition2', 'brushSize', 'seed',
					'pixelSpace', 'screenSpace', 'pixelOffset', 'noise', 'fill', 'animate', 'hue']
			}),
			drawCellsShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'draw-cells-fs',
				attributes: ['position'],
				uniforms: ['cells', 'rules', 'transform']
			}),
			downsampleShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'downsample-cells-fs',
				attributes: ['position'],
				uniforms: ['source', 'screenSpace', 't1', 't2']
			}),
			/* square mesh */
			square: this.vertexBuffer ({
				type: this.gl.TRIANGLE_STRIP,
				vertices: [
			         1.0,  1.0,  0.0,
			        -1.0,  1.0,  0.0,
			         1.0, -1.0,  0.0,
			        -1.0, -1.0,  0.0
		        ]
			}),
			/* buffers */
			cellBuffer: null, 												// current
			cellBuffer1: this.renderTexture ({ width: 1024, height: 512 }),	// back
			cellBuffer2: this.renderTexture ({ width: 1024, height: 512 }),	// front

			/* rules */
			rulesBuffer: this.genRandomRules (4, 4),
			//forkRulesBufer: this.genRandomRules (4, 4),
			activeRules: 0,
			currentRuleset: 0,
			/* transform matrices */
			transform: new Transform (),
			screenTransform: new Transform (),
			/* changeable parameters */
			gridSize: 6,
			numStates: 4,
			numSymbols: 4,
			scrollSpeed: 0.0,
			brushSize: 64.0,
			brushColor: 0.0,
			paused: false,
			tolerance: 0.15,
			friends: 4,
			tx1: 0.0, ty1: 0.0, tx2: 0.0, ty2: 0.0,
			/* other stuff */
			firstFrame: true,
			frameNumber: 0,
		})
		this.cellBuffer = this.cellBuffer1
		this.fillWithNothing ()
		this.initUserInput ()
		this.initGUI ()

		$('.reset').click ()
	},
	resetWithRandomRules: function () {
		this.rulesBuffer.update (this.randomRulesData ())
		//this.forkRulesBufer.update (this.randomRulesData ())
		this.fillWithRandomNoise ()
	},
	randomRulesData: function () {

		var data        = []
		var texSize     = 16
		var random      = _.times (this.numStates,
							_.times.partial (this.numSymbols,
								_.times.partial (4, _.random.partial (255))))

		for (var y = 0; y < texSize; y++) {
			for (var x = 0; x < texSize; x++) {
				data.push (random
					[Math.floor ((y / texSize) * this.numStates)]
					[Math.floor ((x / texSize) * this.numSymbols)]) } }

		return new Uint8Array (_.flatten (data))
	},
	genRandomRules: function (numStates, numSymbols) {
		this.numStates = numStates
		this.numSymbols = numSymbols
		return this.texture ({
			width: 16,
			height: 16,
			data: this.randomRulesData ()
		})
	},
	initUserInput: function () {
		var removePrompt = function () {
			$('.draw-prompt').remove ()
			$(document).unbind ('mousedown', removePrompt)
		}
		$(document).mousedown (removePrompt)
		$(this.canvas).mousewheel ($.proxy (this.onZoom, this))
		$(this.canvas).mousedown ($.proxy (function (e) {
			if (!e.button) {
				this.onPaintStart (e)
			} else {
				this.onDragStart (e)
			}
		}, this))
		$(this.canvas).bind ('contextmenu', function (e) {
			e.preventDefault ()
		})
		$(window).keydown ($.proxy (function (e) {
			switch (e.keyCode) {
				case 18: /* alt */
					if (!this.isPainting) {
						this.onCloneStart (e);
					}
					break;
				case 49: /* 1 */ $('.ruleset-1').click (); break;
				case 50: /* 2 */ $('.ruleset-2').click (); break;
				case 51: /* 3 */ $('.ruleset-3').click (); break;
				case 78: /* n */ this.setBrushType ('noise'); break;
				case 32: /* space */ this.paused = !this.paused; break;
				case 27: /* esc */ this.resetWithRandomRules (); $('.controls .scroll-speed').slider ('value', this.scrollSpeed = 0); break;
			}
		}, this))
		$(window).resize ($.proxy (function () {
			var container = $('.viewport-container')
			var width = container.width (),
				height = container.height ()
			if (width >= this.cellBuffer.width && height >= this.cellBuffer.height) {
				this.resize (this.cellBuffer.width, this.cellBuffer.height)
			} else {
				this.resize (width, height)
			}
		}, this)).resize ()
	},
	hueToCSSColor: function (H) {
		var r = Math.max (0.0, Math.min (1.0, Math.abs (H * 6.0 - 3.0) - 1.0))
		var g = Math.max (0.0, Math.min (1.0, 2.0 - Math.abs (H * 6.0 - 2.0)))
		var b = Math.max (0.0, Math.min (1.0, 2.0 - Math.abs (H * 6.0 - 4.0)))
		return 'rgba(' + Math.round (r * 255) + ',' + Math.round (g * 255) + ',' + Math.round (b * 255) + ', 1.0)'
	},
	initGUI: function () {
		this
			.slider ('.controls .scroll-speed', { min: 0, max: 6, value: 1 }, function (value) {
				this.scrollSpeed = value*2
			})
			.slider ('.controls .brush-scale', { min: 0, max: 10, value: 4, step: 0.1 }, function (value, slider) {
				this.brushSize = Math.pow (2, value)
			})
			.slider ('.controls .tolerance', { min: 0, max: 100, value: 15, step: 1 }, function (value, slider) {
				this.tolerance = value / 100.0;
			})
			.slider ('.controls .friends', { min: 0, max: 8, value: 4, step: 1 }, function (value, slider) {
				this.friends = value;
			})
			.slider ('.controls .brush-color', { min: 0, max: 100, value: 0, step: 1 }, function (value, slider) {
				this.brushColor = value / 100.0;
				slider.find ('a').attr ('style', value > 0 ? 'background:' + this.hueToCSSColor (this.brushColor) + ' !important;' : '')
			})
			.slider ('.controls .grid', { min: 4, max: 11, value: this.gridSize, step: 1 }, function (value, slider) {
				this.gridSize = value
				this.fillWithRandomNoise ()
			})
			.slider ('.controls .states', { min: 1, max: 16, value: this.numStates, step: 1 }, function (value, slider) {
				this.rulesBuffer = this.genRandomRules (this.numStates = value, this.numSymbols)
				//this.forkRulesBufer = this.genRandomRules (this.numStates = value, this.numSymbols)
			})
			.slider ('.controls .symbols', { min: 1, max: 16, value: this.numSymbols, step: 1 }, function (value, slider) {
				this.rulesBuffer = this.genRandomRules (this.numStates, this.numSymbols = value)
				//this.forkRulesBufer = this.genRandomRules (this.numStates = value, this.numSymbols)
			})
		$('.reset')
			.click ($.proxy (function (e) {
				this.reset ($(e.target).attr ('data-reset-with'))
				$('.controls .scroll-speed').slider ('value', this.scrollSpeed = 0)
			}, this))
		$('.btn-pause')
			.click ($.proxy (function (e) {
				this.paused = !this.paused
			}, this))
		$('.btn-scroll')
			.click ($.proxy (function (e) {
				this.enableScroll (!(this.scrollSpeed > 0.0))
			}, this))
		$('.btn')
			.tooltip ({
				placement: 'bottom',
				trigger: 'hover'
			})
		$('.btn-info').click (function () {
			$('.modal.info').modal ('show')
		})
		/*$('.btn-rules').click (function () {
			$('.rules-editor').toggle ()
		})
		$('.multiple-rules-toggle').click ($.proxy (function () {
			this.activeRules = this.activeRules > 0 ? 0 : 3;
			$('.multiple-rules-toggle').html ('multiple rules: ' + (this.activeRules > 0 ? '<strong>on</strong>' : 'off'))
			//$('.ruleset-switch .btn').toggleClass ('disabled', !(this.activeRules > 0))
			//$('.ruleset-1').click ()
		}, this))
		$('.ruleset-switch .btn').each ($.proxy (function (index, btn) {
			$(btn).click ($.proxy (function () {
				this.setCurrentRuleset (index)
			}, this))
		}, this))
		for (var i = 0; i <= 8; i++) {
			$('.rules-editor .rules').append (this.ruleUI (i))
		}
		$('.rules-editor .presets .btn').each ($.proxy (function (index, btn) {
			$(btn).click ($.proxy (function () {
				this.setRules (_.map ($(btn).attr ('data-rules').split (' '), function (i) {
					return parseInt (i)
				}))
			}, this))
		}, this))*/
	},
	setCurrentRuleset: function (i) {
		this.currentRuleset = i
		$('.rules-editor .rule').each ($.proxy (function (index, rule) {
			rule.updateUI (this.rules[i * 16 + index])
		}, this))
	},
	setRules: function (rules) {
		$('.rules-editor .rule').each ($.proxy (function (index, rule) {
			this.rules[this.currentRuleset * 16 + index] = rules[index]
			rule.updateUI (this.rules[this.currentRuleset * 16 + index])
		}, this))
		//this.rulesBuffer.update (this.genRulesBufferData (this.rules))
	},
	/*ruleUI: function (at) {
		var rule = $('<div class="rule">').append ($('<span class="count">' + at + ':</span>'))
		var buttons = $('<div class="btn-group" data-toggle="buttons-radio">').appendTo (rule)
		var die, keep, born
		var updateUI = rule.get (0).updateUI = function (value) {
			die.attr ('class', 'btn ' + (value == 0 ? 'active btn-danger' : 'btn-inverse'))
			keep.attr ('class', 'btn ' + (value == 1 ? 'active btn-info' : 'btn-inverse'))
			born.attr ('class', 'btn ' + (value == 2 ? 'active btn-success' : 'btn-inverse'))
		}
		var commit = $.proxy (function (value) {
			this.rules[this.currentRuleset * 16 + at] = value
			//this.rulesBuffer.update (this.genRulesBufferData (this.rules))
		}, this)
		die = $('<button class="btn">die</button>').click (function () { updateUI (0); commit (0); }).appendTo (buttons)
		keep = $('<button class="btn">keep</button>').click (function () { updateUI (1); commit (1); }).appendTo (buttons)
		born = $('<button class="btn">born</button>').click (function () { updateUI (2); commit (2); }).appendTo (buttons)
		updateUI (this.rules[at])
		return rule
	},*/
	slider: function (selector, cfg, handler) {
		var el = $(selector)
		el.slider (cfg)
			.bind ('slide', $.proxy (function (e, ui) {
				handler.call (this, ui.value, el)
				el.find ('.ui-slider-handle').blur () /* do not want focus */
			}, this))
			.bind ('change', $.proxy (function (e, ui) {
				/* FIXME: change event does not fire ?? */
				handler.call (this, ui.value, el)
			}, this))
		return this
	},
	resizeBuffers: function (w, h) {
		this.cellBuffer1.resize (w, h)
		this.cellBuffer2.resize (w, h)
		$(window).resize ()
		this.reset ('noise')
		this.updateTransform (new Transform ())
	},
	reset: function (type) {
		if (type == 'noise') {
			this.fillWithRandomNoise ()
		} else {
			this.fillWithNothing ()
		}
	},
	eventPoint: function (e) {
		var offset = $(this.canvas).offset ()
		return [
			(e.clientX - offset.left) / (this.viewportWidth * 0.5) - 1.0,
			(offset.top - e.clientY) / (this.viewportHeight * 0.5) + 1.0, 0.0]
	},
	onZoom: function (e) {
		var isMac = navigator.platform == 'MacIntel'
		var zoom = Math.pow (1.03, e.originalEvent.wheelDelta ?
			(e.originalEvent.wheelDelta / (isMac ? 360.0 : 36.0)) : -e.originalEvent.detail * (isMac ? 0.5 : 1.0))
		var origin = this.transform.applyInverse (this.eventPoint (e))
		this.updateTransform (this.transform.multiply (new Transform ()
			.translate (origin)
			.scale ([zoom, zoom, 1.0])
			.translate ([-origin[0], -origin[1], 0.0])))
	},
	getZoom: function () {
		return vec3.length (vec3.subtract (
				this.transform.apply ([0, 0, 0]),
				this.transform.apply ([1, 0, 0])))
	},
	onDragStart: function (e) {
		this.isDragging = true
		var origin = this.transform.applyInverse (this.eventPoint (e))
		$(window).mousemove ($.proxy (function (e) {
			var point = this.transform.applyInverse (this.eventPoint (e))
			this.updateTransform (this.transform.translate ([point[0] - origin[0], point[1] - origin[1], 0.0]))
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isDragging = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	onPaintStart: function (e) {
		this.paintFrom = this.paintTo = this.eventPoint (e)
		this.eraseMode = e.shiftKey
		this.shouldPaint = true
		this.isPainting = true
		this.parametricBrushShader.use ()
		this.parametricBrushShader.uniforms.hue.set1f (Math.random ())
		$(window).mousemove ($.proxy (function (e) {
			this.paintTo = this.eventPoint (e)
			this.eraseMode = e.shiftKey
			this.shouldPaint = true
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isPainting = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	fillWithRandomNoise: function () {
		this.cellBuffer.draw (function () {
			this.randomNoiseShader.use ()
			this.randomNoiseShader.attributes.position.bindBuffer (this.square)
			this.randomNoiseShader.uniforms.gridSize.set1f (this.gridSize)
			this.randomNoiseShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.randomNoiseShader.uniforms.seed2.set2f (Math.random (), Math.random ())
			this.randomNoiseShader.uniforms.seed3.set2f (Math.random (), Math.random ())
			this.randomNoiseShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.square.draw ()
		}, this)
		this.firstFrame = true
	},
	fillWithNothing: function () {
		this.cellBuffer.draw (function () {
			this.gl.clearColor (0.0, 0.0, 0.0, 1.0)
			this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		}, this)
	},
	springDynamics: function () {
		var zoom = this.getZoom ()
		if (!this.isDragging) {
			if (zoom > 0.99) {
				var center = this.transform.apply ([0, 0, 0])
				var springForce = [
					(Math.max (0, Math.abs(center[0]) - (zoom - 1))) / zoom,
					(Math.max (0, Math.abs(center[1]) - (zoom - 1))) / zoom]
				this.updateTransform (this.transform.translate ([
					(Math.pow (1.2, springForce[0]) - 1.0) * (center[0] > 0 ? -1 : 1),
					(Math.pow (1.2, springForce[1]) - 1.0) * (center[1] > 0 ? -1 : 1), 0.0]))
			} else {
				this.updateTransform (this.transform.translate (this.transform.applyInverse ([0, 0, 0])))
			}
		}
		if (zoom < 1.0) {
			var springForce = Math.pow (1.2, 1.0 - zoom)
			this.updateTransform (this.transform.scale ([springForce, springForce, 1.0]))
		}
	},
	updateTransform: function (newTransform) {
		var viewportTransform = new Transform ()
		var aspect = this.viewportWidth / this.viewportHeight
		var bufferAspect = this.cellBuffer.width / this.cellBuffer.height
		if (this.cellBuffer.width < this.viewportWidth && this.cellBuffer.height < this.viewportHeight) {
			viewportTransform = viewportTransform.scale ([
				this.cellBuffer.width / this.viewportWidth,
				this.cellBuffer.height / this.viewportHeight, 1.0])
		} else {
			viewportTransform = viewportTransform.scale (this.cellBuffer.width > this.cellBuffer.height
				? [1.0, aspect / bufferAspect, 1.0]
				: [bufferAspect / aspect, 1.0, 1.0])
		}
		this.transform = newTransform || this.transform
		this.screenTransform = this.transform.multiply (viewportTransform)
	},
	beforeDraw: function () {
		if (!this.paused) {
			if (this.shouldPaint) {
				this.paint (true)
			} else {
				this.iterate ()
			}
		} else if (this.shouldPaint) {
			this.paint (false)
		}
		this.springDynamics ()
	},
	renderCells: function (callback) {
		/* backbuffering */
		var targetBuffer = (this.cellBuffer == this.cellBuffer1 ? this.cellBuffer2 : this.cellBuffer1)
		targetBuffer.draw (callback, this)
		this.cellBuffer = targetBuffer
		this.firstFrame = false
	},
	iterate: function () {
		for (var i = 0; i < 20; i++) {
			this.renderCells (function () {
				this.updateProgramShader.use ()
				this.updateProgramShader.attributes.position.bindBuffer (this.square)
				this.updateProgramShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0)
				this.updateProgramShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
				//this.updateProgramShader.uniforms.rules.bindTexture (this.forkRulesBufer, 2)
				this.updateProgramShader.uniforms.seed.set2f (Math.random (), Math.random ())

				//this.updateProgramShader.uniforms.lifeDecrease.set1f (1.0 / 255.0)

				this.frameNumber++
				if (this.frameNumber > 20) {
					this.updateProgramShader.uniforms.lifeDecrease.set1f (1.0 / 255.0)
					this.frameNumber = 0
				} else {
					this.updateProgramShader.uniforms.lifeDecrease.set1f (0.0);
				}

				this.updateProgramShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
				this.updateProgramShader.uniforms.pixelOffset.set2f (
					0.5 / this.cellBuffer.width,
					0.5 / this.cellBuffer.height)
			    this.square.draw ()
			})
			/*this.renderCells (function () {
				this.moveTapeShader.use ()
				this.moveTapeShader.attributes.position.bindBuffer (this.square)
				this.moveTapeShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0)
				this.moveTapeShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
				this.moveTapeShader.uniforms.pixelOffset.set2f (
					0.0 / this.cellBuffer.width,
					-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height)
			    this.square.draw ()
			})*/
		}
	},
	paint: function (animate) {
		this.paintParametricBrush (animate)
		this.paintFrom = this.paintTo
		this.shouldPaint = false
	},
	paintParametricBrush: function (animate) {
		this.renderCells (function () {
			var pixelSpace = new Transform ()
				.scale ([this.viewportWidth, this.viewportHeight, 1.0])
				.multiply (this.screenTransform)
			var texelSize =
				pixelSpace.apply ([0,0,0])[0] -
				pixelSpace.apply ([-1.0 / this.cellBuffer.width, 0, 0])[0]
			this.parametricBrushShader.use ()
			this.parametricBrushShader.attributes.position.bindBuffer (this.square)
			this.parametricBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
			this.parametricBrushShader.uniforms.brushPosition1.set2fv (this.screenTransform.applyInverse (this.paintFrom))
			this.parametricBrushShader.uniforms.brushPosition2.set2fv (this.screenTransform.applyInverse (this.paintTo))
			this.parametricBrushShader.uniforms.pixelSpace.setMatrix (pixelSpace)
			this.parametricBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height) : 0.0)
			this.parametricBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.parametricBrushShader.uniforms.brushSize.set1f (Math.max (this.brushSize, texelSize))
			this.parametricBrushShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.parametricBrushShader.uniforms.noise.set1i (this.brushType == 'noise')
			this.parametricBrushShader.uniforms.fill.set1f (this.eraseMode ? 0.0 : 1.0)
			this.parametricBrushShader.uniforms.animate.set1i (animate ? 1 : 0)
			if (this.brushColor > 0.01) {
				this.parametricBrushShader.uniforms.hue.set1f (this.brushColor)
			}
		    this.square.draw ()
		})
	},
	draw: function () {
		this.gl.disable (this.gl.DEPTH_TEST)
		this.drawCellsShader.use ()
		this.drawCellsShader.attributes.position.bindBuffer (this.square)
		this.drawCellsShader.uniforms.transform.setMatrix (this.screenTransform)
		this.drawCellsShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
		this.drawCellsShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
		this.square.draw ()
	},
	noGL: function () {
		$('.no-webgl').modal ('show')
	}
})

$(document).ready (function () {
	var life = new Life ({
		canvas: $('.viewport').get (0)
	})
})