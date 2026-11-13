(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.WindGL = factory());
})(this, (function () { 'use strict';

    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);

        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }

        return shader;
    }

    function createProgram(gl, vertexSource, fragmentSource) {
        const program = gl.createProgram();

        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }

        const wrapper = {program: program};

        const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < numAttributes; i++) {
            const attribute = gl.getActiveAttrib(program, i);
            wrapper[attribute.name] = gl.getAttribLocation(program, attribute.name);
        }
        const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < numUniforms; i++) {
            const uniform = gl.getActiveUniform(program, i);
            wrapper[uniform.name] = gl.getUniformLocation(program, uniform.name);
        }

        return wrapper;
    }

    function createTexture(gl, filter, data, width, height) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        if (data instanceof Uint8Array) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    }

    function bindTexture(gl, texture, unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    function createBuffer(gl, data) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return buffer;
    }

    function bindAttribute(gl, buffer, attribute, numComponents) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, numComponents, gl.FLOAT, false, 0, 0);
    }

    function bindFramebuffer(gl, framebuffer, texture) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        if (texture) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }
    }

    var drawVert = "precision mediump float;\n\nattribute float a_index;\n\nuniform sampler2D u_particles;\nuniform float u_particles_res;\n\n// particle positions are stored relative to u_bbox (minX, minY, sizeX, sizeY),\n// in web-mercator world coordinates (0..1 across the whole world)\nuniform vec4 u_bbox;\n// currently visible part of the world, same coordinate space\nuniform vec4 u_view;\n\nvarying vec2 v_particle_pos;\n\nvoid main() {\n    vec4 color = texture2D(u_particles, vec2(\n        fract(a_index / u_particles_res),\n        floor(a_index / u_particles_res) / u_particles_res));\n\n    // decode current particle position from the pixel's RGBA value\n    vec2 pos = vec2(\n        color.r / 255.0 + color.b,\n        color.g / 255.0 + color.a);\n\n    // global web-mercator position of the particle\n    v_particle_pos = u_bbox.xy + pos * u_bbox.zw;\n\n    vec2 clip = (v_particle_pos - u_view.xy) / u_view.zw;\n\n    gl_PointSize = 1.0;\n    gl_Position = vec4(2.0 * clip.x - 1.0, 1.0 - 2.0 * clip.y, 0, 1);\n}\n";

    var drawFrag = "precision mediump float;\n\nuniform sampler2D u_wind0;\nuniform sampler2D u_wind1;\nuniform vec2 u_wind_min0;\nuniform vec2 u_wind_max0;\nuniform vec2 u_wind_min1;\nuniform vec2 u_wind_max1;\nuniform float u_wind_interp;\nuniform sampler2D u_color_ramp;\n\nvarying vec2 v_particle_pos;\n\nconst float PI = 3.141592653589793;\n\n// web-mercator world position -> wind data texture coordinates (equirectangular)\nvec2 merc_to_uv(const vec2 p) {\n    float m = PI * (1.0 - 2.0 * p.y);\n    float lat = atan(0.5 * (exp(m) - exp(-m)));\n    return vec2(p.x, 0.5 - lat / PI);\n}\n\nvoid main() {\n    vec2 uv = merc_to_uv(v_particle_pos);\n\n    // interpolate between the two surrounding time steps on the GPU\n    vec2 velocity = mix(\n        mix(u_wind_min0, u_wind_max0, texture2D(u_wind0, uv).rg),\n        mix(u_wind_min1, u_wind_max1, texture2D(u_wind1, uv).rg),\n        u_wind_interp);\n    float speed_t = length(velocity) / length(mix(u_wind_max0, u_wind_max1, u_wind_interp));\n\n    // color ramp is encoded in a 16x16 texture\n    vec2 ramp_pos = vec2(\n        fract(16.0 * speed_t),\n        floor(16.0 * speed_t) / 16.0);\n\n    gl_FragColor = texture2D(u_color_ramp, ramp_pos);\n}\n";

    var quadVert = "precision mediump float;\r\n\r\nattribute vec2 a_pos;\r\n\r\nvarying vec2 v_tex_pos;\r\n\r\nvoid main() {\r\n    v_tex_pos = a_pos;\r\n    gl_Position = vec4(1.0 - 2.0 * a_pos, 0, 1);\r\n}\r\n";

    var screenFrag = "precision mediump float;\r\n\r\nuniform sampler2D u_screen;\r\nuniform float u_opacity;\r\n\r\nvarying vec2 v_tex_pos;\r\n\r\nvoid main() {\r\n    vec4 color = texture2D(u_screen, 1.0 - v_tex_pos);\r\n    // a hack to guarantee opacity fade out even with a value close to 1.0\r\n    gl_FragColor = vec4(floor(255.0 * color * u_opacity) / 255.0);\r\n}\r\n";

    var updateFrag = "precision highp float;\n\nuniform sampler2D u_particles;\nuniform sampler2D u_wind0;\nuniform sampler2D u_wind1;\nuniform vec2 u_wind_res;\nuniform vec2 u_wind_min0;\nuniform vec2 u_wind_max0;\nuniform vec2 u_wind_min1;\nuniform vec2 u_wind_max1;\nuniform float u_wind_interp;\nuniform float u_rand_seed;\nuniform float u_speed_factor;\nuniform float u_drop_rate;\nuniform float u_drop_rate_bump;\n\n// particle positions are stored relative to this bbox (minX, minY, sizeX, sizeY),\n// in web-mercator world coordinates; it tracks the view with some padding\nuniform vec4 u_bbox;\n\nvarying vec2 v_tex_pos;\n\nconst float PI = 3.141592653589793;\n\n// pseudo-random generator\nconst vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);\nfloat rand(const vec2 co) {\n    float t = dot(rand_constants.xy, co);\n    return fract(sin(t) * (rand_constants.z + t));\n}\n\n// web-mercator world position -> wind data texture coordinates (equirectangular)\nvec2 merc_to_uv(const vec2 p) {\n    float m = PI * (1.0 - 2.0 * p.y);\n    float lat = atan(0.5 * (exp(m) - exp(-m)));\n    return vec2(p.x, 0.5 - lat / PI);\n}\n\n// wind speed lookup; use manual bilinear filtering based on 4 adjacent pixels for smooth interpolation\nvec2 lookup_wind(const sampler2D wind, const vec2 uv) {\n    vec2 px = 1.0 / u_wind_res;\n    vec2 vc = (floor(uv * u_wind_res)) * px;\n    vec2 f = fract(uv * u_wind_res);\n    vec2 tl = texture2D(wind, vc).rg;\n    vec2 tr = texture2D(wind, vc + vec2(px.x, 0)).rg;\n    vec2 bl = texture2D(wind, vc + vec2(0, px.y)).rg;\n    vec2 br = texture2D(wind, vc + px).rg;\n    return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);\n}\n\nvoid main() {\n    vec4 color = texture2D(u_particles, v_tex_pos);\n    vec2 pos = vec2(\n        color.r / 255.0 + color.b,\n        color.g / 255.0 + color.a); // decode particle position from pixel RGBA\n\n    // global web-mercator position of the particle\n    vec2 global_pos = u_bbox.xy + pos * u_bbox.zw;\n    vec2 uv = merc_to_uv(global_pos);\n\n    // interpolate between the two surrounding time steps on the GPU\n    vec2 velocity = mix(\n        mix(u_wind_min0, u_wind_max0, lookup_wind(u_wind0, uv)),\n        mix(u_wind_min1, u_wind_max1, lookup_wind(u_wind1, uv)),\n        u_wind_interp);\n    float speed_t = length(velocity) / length(mix(u_wind_max0, u_wind_max1, u_wind_interp));\n\n    // Web-mercator is conformal, so a local displacement is isotropic and no\n    // latitude distortion correction is needed. The offset is scaled with the\n    // view width so that the apparent speed stays the same at any zoom level;\n    // since positions are stored relative to u_bbox, the zoom factor cancels\n    // out and only the bbox padding remains.\n    vec2 offset = vec2(velocity.x, -velocity.y) * 0.0001 * u_speed_factor *\n        u_bbox.z / u_bbox.zw;\n\n    // update particle position; particles leaving the bbox are respawned below\n    pos = pos + offset;\n\n    // a random seed to use for the particle drop\n    vec2 seed = (pos + v_tex_pos) * u_rand_seed;\n\n    // drop rate is a chance a particle will restart at random position, to avoid degeneration\n    float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;\n    float drop = step(1.0 - drop_rate, rand(seed));\n\n    // force a respawn for particles that drifted out of the reference bbox\n    vec2 in_bounds = step(vec2(0.0), pos) * step(pos, vec2(1.0));\n    drop = max(drop, 1.0 - in_bounds.x * in_bounds.y);\n\n    vec2 random_pos = vec2(\n        rand(seed + 1.3),\n        rand(seed + 2.1));\n    pos = mix(pos, random_pos, drop);\n\n    // encode the new particle position back into RGBA\n    gl_FragColor = vec4(\n        fract(pos * 255.0),\n        floor(pos * 255.0) / 255.0);\n}\n";

    var reencodeFrag = "precision highp float;\n\nuniform sampler2D u_particles;\n\n// previous and new reference bboxes (minX, minY, sizeX, sizeY),\n// in web-mercator world coordinates\nuniform vec4 u_prev_bbox;\nuniform vec4 u_bbox;\nuniform float u_rand_seed;\n\nvarying vec2 v_tex_pos;\n\n// pseudo-random generator\nconst vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);\nfloat rand(const vec2 co) {\n    float t = dot(rand_constants.xy, co);\n    return fract(sin(t) * (rand_constants.z + t));\n}\n\nvoid main() {\n    vec4 color = texture2D(u_particles, v_tex_pos);\n    vec2 pos = vec2(\n        color.r / 255.0 + color.b,\n        color.g / 255.0 + color.a); // decode particle position from pixel RGBA\n\n    // keep the same global web-mercator position, re-encoded against the new bbox\n    vec2 global_pos = u_prev_bbox.xy + pos * u_prev_bbox.zw;\n    pos = (global_pos - u_bbox.xy) / u_bbox.zw;\n\n    // particles that fall outside the new bbox restart at a random place inside it\n    vec2 seed = (pos + v_tex_pos) * u_rand_seed;\n    vec2 in_bounds = step(vec2(0.0), pos) * step(pos, vec2(1.0));\n    float outside = 1.0 - in_bounds.x * in_bounds.y;\n    vec2 random_pos = vec2(\n        rand(seed + 1.3),\n        rand(seed + 2.1));\n    pos = mix(pos, random_pos, outside);\n\n    // encode the new particle position back into RGBA\n    gl_FragColor = vec4(\n        fract(pos * 255.0),\n        floor(pos * 255.0) / 255.0);\n}\n";

    const defaultRampColors = {
        0.0: '#3288bd',
        0.1: '#66c2a5',
        0.2: '#abdda4',
        0.3: '#e6f598',
        0.4: '#fee08b',
        0.5: '#fdae61',
        0.6: '#f46d43',
        1.0: '#d53e4f'
    };

    // the particle reference bbox extends beyond the view by this fraction on each
    // side, so that particles can drift into the view from just outside of it
    const VIEW_PADDING = 0.5;

    class WindGL {
        constructor(gl) {
            this.gl = gl;

            this.fadeOpacity = 0.996; // how fast the particle trails fade on each frame
            this.speedFactor = 0.25; // how fast the particles move
            this.dropRate = 0.003; // how often the particles move to a random place
            this.dropRateBump = 0.01; // drop rate increase relative to individual particle speed

            // interpolation weight between the two wind time steps (see setWindPair)
            this.windInterpolation = 0;

            this.drawProgram = createProgram(gl, drawVert, drawFrag);
            this.screenProgram = createProgram(gl, quadVert, screenFrag);
            this.updateProgram = createProgram(gl, quadVert, updateFrag);
            this.reencodeProgram = createProgram(gl, quadVert, reencodeFrag);

            this.quadBuffer = createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
            this.framebuffer = gl.createFramebuffer();

            this.setColorRamp(defaultRampColors);
            this.setView([0, 0, 1, 1]);
            this.resize();
        }

        resize() {
            const gl = this.gl;
            const width = gl.canvas.width;
            const height = gl.canvas.height;
            const emptyPixels = new Uint8Array(width * height * 4);

            const prevBackgroundTexture = this.backgroundTexture;
            const prevScreenTexture = this.screenTexture;

            // screen textures to hold the drawn screen for the previous and the current frame
            this.backgroundTexture = createTexture(gl, gl.NEAREST, emptyPixels, width, height);
            this.screenTexture = createTexture(gl, gl.NEAREST, emptyPixels, width, height);

            if (prevBackgroundTexture) {
                // carry the existing trails over to the resized textures, so that
                // resizing the canvas or switching pixel ratio does not reset the
                // particle state
                bindFramebuffer(gl, this.framebuffer, this.backgroundTexture);
                gl.viewport(0, 0, width, height);
                this.drawTexture(prevBackgroundTexture, 1.0);
                bindFramebuffer(gl, null);

                gl.deleteTexture(prevBackgroundTexture);
                gl.deleteTexture(prevScreenTexture);
            }
        }

        setColorRamp(colors) {
            // lookup texture for colorizing the particles according to their speed
            this.colorRampTexture = createTexture(this.gl, this.gl.LINEAR, getColorRamp(colors), 16, 16);
        }

        // sets the visible part of the world, in web-mercator world coordinates
        // (x and y in 0..1 across the whole world): [minX, minY, maxX, maxY]
        setView(bounds) {
            const width = bounds[2] - bounds[0];
            const height = bounds[3] - bounds[1];
            const view = [bounds[0], bounds[1], width, height];
            const bbox = [
                bounds[0] - width * VIEW_PADDING,
                bounds[1] - height * VIEW_PADDING,
                width * (1 + 2 * VIEW_PADDING),
                height * (1 + 2 * VIEW_PADDING)
            ];

            if (this._bbox &&
                Math.abs(this._bbox[0] - bbox[0]) < 1e-9 &&
                Math.abs(this._bbox[1] - bbox[1]) < 1e-9 &&
                Math.abs(this._bbox[2] - bbox[2]) < 1e-9 &&
                Math.abs(this._bbox[3] - bbox[3]) < 1e-9) {
                return; // view didn't change
            }

            if (this.particleStateTexture0) {
                // re-encode existing particle positions against the new reference
                // bbox, keeping each particle at the same place in the world
                this.reencodeParticles(bbox);
            }
            this._view = view;
            this._bbox = bbox;
            // the previous frame no longer aligns with the view; the next draw
            // starts the trails from scratch instead of smearing them
            this._viewChanged = true;
        }

        set numParticles(numParticles) {
            const gl = this.gl;

            // we create a square texture where each pixel will hold a particle position encoded as RGBA
            const particleRes = this.particleStateResolution = Math.ceil(Math.sqrt(numParticles));
            this._numParticles = particleRes * particleRes;

            const particleState = new Uint8Array(this._numParticles * 4);
            for (let i = 0; i < particleState.length; i++) {
                particleState[i] = Math.floor(Math.random() * 256); // randomize the initial particle positions
            }
            // textures to hold the particle state for the current and the next frame
            this.particleStateTexture0 = createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);
            this.particleStateTexture1 = createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);

            const particleIndices = new Float32Array(this._numParticles);
            for (let i = 0; i < this._numParticles; i++) particleIndices[i] = i;
            this.particleIndexBuffer = createBuffer(gl, particleIndices);
        }
        get numParticles() {
            return this._numParticles;
        }

        setWind(windData) {
            this.setWindPair(windData, windData);
            this.windInterpolation = 0;
        }

        // sets the two wind time steps that get interpolated on the GPU;
        // use the windInterpolation property (0..1) to blend between them
        setWindPair(windData0, windData1) {
            const gl = this.gl;

            this.windData = windData0;
            this.windData1 = windData1;

            if (this.windTexture0 && this.windTexture0 !== this.windTexture1) {
                gl.deleteTexture(this.windTexture0);
            }
            if (this.windTexture1) {
                gl.deleteTexture(this.windTexture1);
            }

            this.windTexture0 = createTexture(gl, gl.LINEAR, windData0.image);
            this.windTexture1 = windData1 === windData0 ?
                this.windTexture0 : createTexture(gl, gl.LINEAR, windData1.image);
        }

        draw() {
            const gl = this.gl;
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.STENCIL_TEST);

            bindTexture(gl, this.windTexture0, 0);
            bindTexture(gl, this.particleStateTexture0, 1);
            bindTexture(gl, this.windTexture1, 3);

            this.drawScreen();
            this.updateParticles();
        }

        drawScreen() {
            const gl = this.gl;
            // draw the screen into a temporary framebuffer to retain it as the background on the next frame
            bindFramebuffer(gl, this.framebuffer, this.screenTexture);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

            if (this._viewChanged) {
                // the view moved since the last frame: drop the old trails instead
                // of smearing them across the map
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                this._viewChanged = false;
            } else {
                this.drawTexture(this.backgroundTexture, this.fadeOpacity);
            }
            this.drawParticles();

            bindFramebuffer(gl, null);
            // enable blending to support drawing on top of an existing background (e.g. a map)
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            this.drawTexture(this.screenTexture, 1.0);
            gl.disable(gl.BLEND);

            // save the current screen as the background for the next frame
            const temp = this.backgroundTexture;
            this.backgroundTexture = this.screenTexture;
            this.screenTexture = temp;
        }

        drawTexture(texture, opacity) {
            const gl = this.gl;
            const program = this.screenProgram;
            gl.useProgram(program.program);

            bindAttribute(gl, this.quadBuffer, program.a_pos, 2);
            bindTexture(gl, texture, 2);
            gl.uniform1i(program.u_screen, 2);
            gl.uniform1f(program.u_opacity, opacity);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        drawParticles() {
            const gl = this.gl;
            const program = this.drawProgram;
            gl.useProgram(program.program);

            bindAttribute(gl, this.particleIndexBuffer, program.a_index, 1);
            bindTexture(gl, this.colorRampTexture, 2);

            gl.uniform1i(program.u_wind0, 0);
            gl.uniform1i(program.u_particles, 1);
            gl.uniform1i(program.u_color_ramp, 2);
            gl.uniform1i(program.u_wind1, 3);

            gl.uniform1f(program.u_particles_res, this.particleStateResolution);
            gl.uniform2f(program.u_wind_min0, this.windData.uMin, this.windData.vMin);
            gl.uniform2f(program.u_wind_max0, this.windData.uMax, this.windData.vMax);
            gl.uniform2f(program.u_wind_min1, this.windData1.uMin, this.windData1.vMin);
            gl.uniform2f(program.u_wind_max1, this.windData1.uMax, this.windData1.vMax);
            gl.uniform1f(program.u_wind_interp, this.windInterpolation);

            gl.uniform4f(program.u_bbox, this._bbox[0], this._bbox[1], this._bbox[2], this._bbox[3]);
            gl.uniform4f(program.u_view, this._view[0], this._view[1], this._view[2], this._view[3]);

            gl.drawArrays(gl.POINTS, 0, this._numParticles);
        }

        updateParticles() {
            const gl = this.gl;
            bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
            gl.viewport(0, 0, this.particleStateResolution, this.particleStateResolution);

            const program = this.updateProgram;
            gl.useProgram(program.program);

            bindAttribute(gl, this.quadBuffer, program.a_pos, 2);

            gl.uniform1i(program.u_wind0, 0);
            gl.uniform1i(program.u_particles, 1);
            gl.uniform1i(program.u_wind1, 3);

            gl.uniform1f(program.u_rand_seed, Math.random());
            gl.uniform2f(program.u_wind_res, this.windData.width, this.windData.height);
            gl.uniform2f(program.u_wind_min0, this.windData.uMin, this.windData.vMin);
            gl.uniform2f(program.u_wind_max0, this.windData.uMax, this.windData.vMax);
            gl.uniform2f(program.u_wind_min1, this.windData1.uMin, this.windData1.vMin);
            gl.uniform2f(program.u_wind_max1, this.windData1.uMax, this.windData1.vMax);
            gl.uniform1f(program.u_wind_interp, this.windInterpolation);
            gl.uniform1f(program.u_speed_factor, this.speedFactor);
            gl.uniform1f(program.u_drop_rate, this.dropRate);
            gl.uniform1f(program.u_drop_rate_bump, this.dropRateBump);
            gl.uniform4f(program.u_bbox, this._bbox[0], this._bbox[1], this._bbox[2], this._bbox[3]);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // swap the particle state textures so the new one becomes the current one
            const temp = this.particleStateTexture0;
            this.particleStateTexture0 = this.particleStateTexture1;
            this.particleStateTexture1 = temp;
        }

        reencodeParticles(bbox) {
            const gl = this.gl;
            bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
            gl.viewport(0, 0, this.particleStateResolution, this.particleStateResolution);

            const program = this.reencodeProgram;
            gl.useProgram(program.program);

            bindAttribute(gl, this.quadBuffer, program.a_pos, 2);
            bindTexture(gl, this.particleStateTexture0, 1);

            gl.uniform1i(program.u_particles, 1);
            gl.uniform4f(program.u_prev_bbox, this._bbox[0], this._bbox[1], this._bbox[2], this._bbox[3]);
            gl.uniform4f(program.u_bbox, bbox[0], bbox[1], bbox[2], bbox[3]);
            gl.uniform1f(program.u_rand_seed, Math.random());

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // swap the particle state textures so the new one becomes the current one
            const temp = this.particleStateTexture0;
            this.particleStateTexture0 = this.particleStateTexture1;
            this.particleStateTexture1 = temp;
        }
    }

    function getColorRamp(colors) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = 256;
        canvas.height = 1;

        const gradient = ctx.createLinearGradient(0, 0, 256, 0);
        for (const stop in colors) {
            gradient.addColorStop(+stop, colors[stop]);
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 1);

        return new Uint8Array(ctx.getImageData(0, 0, 256, 1).data);
    }

    return WindGL;

}));
