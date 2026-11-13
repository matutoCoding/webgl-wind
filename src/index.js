
import * as util from './util';

import drawVert from './shaders/draw.vert.glsl';
import drawFrag from './shaders/draw.frag.glsl';

import quadVert from './shaders/quad.vert.glsl';

import screenFrag from './shaders/screen.frag.glsl';
import updateFrag from './shaders/update.frag.glsl';
import reencodeFrag from './shaders/reencode.frag.glsl';

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

export default class WindGL {
    constructor(gl) {
        this.gl = gl;

        this.fadeOpacity = 0.996; // how fast the particle trails fade on each frame
        this.speedFactor = 0.25; // how fast the particles move
        this.dropRate = 0.003; // how often the particles move to a random place
        this.dropRateBump = 0.01; // drop rate increase relative to individual particle speed

        // interpolation weight between the two wind time steps (see setWindPair)
        this.windInterpolation = 0;

        this.drawProgram = util.createProgram(gl, drawVert, drawFrag);
        this.screenProgram = util.createProgram(gl, quadVert, screenFrag);
        this.updateProgram = util.createProgram(gl, quadVert, updateFrag);
        this.reencodeProgram = util.createProgram(gl, quadVert, reencodeFrag);

        this.quadBuffer = util.createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
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
        this.backgroundTexture = util.createTexture(gl, gl.NEAREST, emptyPixels, width, height);
        this.screenTexture = util.createTexture(gl, gl.NEAREST, emptyPixels, width, height);

        if (prevBackgroundTexture) {
            // carry the existing trails over to the resized textures, so that
            // resizing the canvas or switching pixel ratio does not reset the
            // particle state
            util.bindFramebuffer(gl, this.framebuffer, this.backgroundTexture);
            gl.viewport(0, 0, width, height);
            this.drawTexture(prevBackgroundTexture, 1.0);
            util.bindFramebuffer(gl, null);

            gl.deleteTexture(prevBackgroundTexture);
            gl.deleteTexture(prevScreenTexture);
        }
    }

    setColorRamp(colors) {
        // lookup texture for colorizing the particles according to their speed
        this.colorRampTexture = util.createTexture(this.gl, this.gl.LINEAR, getColorRamp(colors), 16, 16);
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
        this.particleStateTexture0 = util.createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);
        this.particleStateTexture1 = util.createTexture(gl, gl.NEAREST, particleState, particleRes, particleRes);

        const particleIndices = new Float32Array(this._numParticles);
        for (let i = 0; i < this._numParticles; i++) particleIndices[i] = i;
        this.particleIndexBuffer = util.createBuffer(gl, particleIndices);
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

        this.windTexture0 = util.createTexture(gl, gl.LINEAR, windData0.image);
        this.windTexture1 = windData1 === windData0 ?
            this.windTexture0 : util.createTexture(gl, gl.LINEAR, windData1.image);
    }

    draw() {
        const gl = this.gl;
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        util.bindTexture(gl, this.windTexture0, 0);
        util.bindTexture(gl, this.particleStateTexture0, 1);
        util.bindTexture(gl, this.windTexture1, 3);

        this.drawScreen();
        this.updateParticles();
    }

    drawScreen() {
        const gl = this.gl;
        // draw the screen into a temporary framebuffer to retain it as the background on the next frame
        util.bindFramebuffer(gl, this.framebuffer, this.screenTexture);
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

        util.bindFramebuffer(gl, null);
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

        util.bindAttribute(gl, this.quadBuffer, program.a_pos, 2);
        util.bindTexture(gl, texture, 2);
        gl.uniform1i(program.u_screen, 2);
        gl.uniform1f(program.u_opacity, opacity);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    drawParticles() {
        const gl = this.gl;
        const program = this.drawProgram;
        gl.useProgram(program.program);

        util.bindAttribute(gl, this.particleIndexBuffer, program.a_index, 1);
        util.bindTexture(gl, this.colorRampTexture, 2);

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
        util.bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
        gl.viewport(0, 0, this.particleStateResolution, this.particleStateResolution);

        const program = this.updateProgram;
        gl.useProgram(program.program);

        util.bindAttribute(gl, this.quadBuffer, program.a_pos, 2);

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
        util.bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
        gl.viewport(0, 0, this.particleStateResolution, this.particleStateResolution);

        const program = this.reencodeProgram;
        gl.useProgram(program.program);

        util.bindAttribute(gl, this.quadBuffer, program.a_pos, 2);
        util.bindTexture(gl, this.particleStateTexture0, 1);

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
