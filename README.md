## WebGL Wind — [Demo](https://mapbox.github.io/webgl-wind/demo/)

A WebGL-powered visualization of wind power.
Capable of rendering up to 1 million wind particles at 60fps.

This project is heavily inspired by the work of:

- [Cameron Beccario](https://twitter.com/cambecc)
and his wonderful [Earth project](https://earth.nullschool.net/)
with its [open-source version](https://github.com/cambecc/earth).
- [Fernanda Viégas and Martin Wattenberg](http://hint.fm/) and their
[US Wind Map project](http://hint.fm/projects/wind/).
- [Chris Wellons](http://nullprogram.com) and his WebGL tutorials,
in particular [A GPU Approach to Particle Physics](http://nullprogram.com/blog/2014/06/29/).
- [Greggman](http://games.greggman.com/game/) and his [WebGL Fundamentals](http://webglfundamentals.org/) guide.

### Running the demo locally

```bash
npm install
npm run build
npm start
# open http://127.0.0.1:1337/demo/
```

The demo is a pannable/zoomable web-mercator map: drag to pan, use the mouse
wheel to zoom, and hover over the map to read the wind speed and direction at
that point. The 48-hour forecast plays back automatically, with the two
surrounding time steps interpolated on the GPU.

### API

Existing usage is unchanged:

```js
const wind = new WindGL(gl);
wind.numParticles = 65536;
wind.setWind(windData); // single time step, as before
wind.draw();
```

Optional additions:

```js
// visible part of the world in web-mercator coordinates (0..1): [minX, minY, maxX, maxY]
wind.setView([0.7, 0.3, 0.9, 0.5]);

// two time steps, blended on the GPU via wind.windInterpolation (0..1)
wind.setWindPair(windData0, windData1);
wind.windInterpolation = 0.5;
```

`wind.resize()` preserves the particle state and trails across canvas resizes
and pixel-ratio changes.

### Downloading weather data

1. Install [ecCodes](https://confluence.ecmwf.int//display/ECC/ecCodes+Home) (e.g. `brew install eccodes`).
2. Edit constants in `data/download.sh` for desired date, time and resolution.
3. Run `./data/download.sh <dir>` to generate wind data files (`png` and `json`) for use with the library.
