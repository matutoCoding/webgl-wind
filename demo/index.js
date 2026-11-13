// using var to work around a WebKit bug
var canvas = document.getElementById('canvas'); // eslint-disable-line
var coastlineCanvas = document.getElementById('coastline'); // eslint-disable-line
var hoverEl = document.getElementById('hover'); // eslint-disable-line

let pxRatio = getPxRatio();

const gl = canvas.getContext('webgl', {antialiasing: false});

const wind = window.wind = new WindGL(gl);
wind.numParticles = 65536;

// ---------------------------------------------------------------------------
// view state: a pannable/zoomable web-mercator map.
// x/y are the view center in mercator world coordinates (0..1 across the whole
// world), width is the visible fraction of the world's width.
const view = {
    x: 0.792,   // ~105°E
    y: 0.394,   // ~35°N
    width: 0.18 // roughly China at province level
};

function viewBounds() {
    const w = view.width;
    const h = w * canvas.height / canvas.width;
    return [view.x - w / 2, view.y - h / 2, view.x + w / 2, view.y + h / 2];
}

function clampView() {
    view.width = Math.min(1, Math.max(0.004, view.width));
    const w = view.width;
    const h = w * canvas.height / canvas.width;
    view.x = w >= 1 ? 0.5 : Math.min(1 - w / 2, Math.max(w / 2, view.x));
    view.y = h >= 1 ? 0.5 : Math.min(1 - h / 2, Math.max(h / 2, view.y));
}

function applyView() {
    clampView();
    wind.setView(viewBounds());
    drawCoastline();
}

// pan with mouse drag
let dragging = false;
let dragX = 0;
let dragY = 0;

canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    canvas.classList.add('dragging');
});
window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    const bounds = viewBounds();
    view.x -= (e.clientX - dragX) / canvas.clientWidth * (bounds[2] - bounds[0]);
    view.y -= (e.clientY - dragY) / canvas.clientHeight * (bounds[3] - bounds[1]);
    dragX = e.clientX;
    dragY = e.clientY;
    applyView();
});
window.addEventListener('mouseup', function () {
    dragging = false;
    canvas.classList.remove('dragging');
});

// zoom around the cursor with the mouse wheel
canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const bounds = viewBounds();
    const fx = e.clientX / canvas.clientWidth;
    const fy = e.clientY / canvas.clientHeight;
    // mercator point under the cursor, kept fixed while zooming
    const mx = bounds[0] + fx * (bounds[2] - bounds[0]);
    const my = bounds[1] + fy * (bounds[3] - bounds[1]);

    view.width *= Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    clampView();

    const w = view.width;
    const h = w * canvas.height / canvas.width;
    view.x = mx - fx * w + w / 2;
    view.y = my - fy * h + h / 2;
    applyView();
}, {passive: false});

// ---------------------------------------------------------------------------
// wind data: 9 time steps, 6 hours apart, covering 48 hours
const windFiles = [
    '2016112000', '2016112006', '2016112012', '2016112018',
    '2016112100', '2016112106', '2016112112', '2016112118',
    '2016112200'
];
const HOURS = 48;
const STEP_HOURS = 6;

const windFields = [];
let loadedCount = 0;

windFiles.forEach(function (name, i) {
    getJSON('wind/' + name + '.json', function (windData) {
        const windImage = new Image();
        windImage.onload = function () {
            windData.image = windImage;
            windData.pixels = decodeWindImage(windImage); // for the hover readout
            windFields[i] = windData;
            loadedCount++;
        };
        windImage.src = 'wind/' + name + '.png';
    });
});

// automatic playback with GPU-side interpolation between adjacent time steps
let hour = 0;
let pairIndex = -1;
let lastFrameTime = 0;

const meta = {
    '播放': true,
    '时间 (2016-11-20+h)': 0,
    '播放速度': 1.5,
    'retina resolution': true,
    'github.com/mapbox/webgl-wind': function () {
        window.location = 'https://github.com/mapbox/webgl-wind';
    }
};

function frame(time) {
    const dt = Math.min((time - lastFrameTime) / 1000, 0.1);
    lastFrameTime = time;

    if (loadedCount === windFiles.length) {
        if (meta['播放']) {
            hour = (hour + dt * meta['播放速度']) % HOURS;
        }
        meta['时间 (2016-11-20+h)'] = hour;
        const i = Math.min(Math.floor(hour / STEP_HOURS), windFiles.length - 2);
        if (i !== pairIndex) {
            pairIndex = i;
            wind.setWindPair(windFields[i], windFields[i + 1]);
        }
        wind.windInterpolation = hour / STEP_HOURS - i;
    }
    if (wind.windData) {
        wind.draw();
    }
    requestAnimationFrame(frame);
}

const gui = new dat.GUI();
gui.add(wind, 'numParticles', 1024, 589824);
gui.add(wind, 'fadeOpacity', 0.96, 0.999).step(0.001).updateDisplay();
gui.add(wind, 'speedFactor', 0.05, 1.0);
gui.add(wind, 'dropRate', 0, 0.1);
gui.add(wind, 'dropRateBump', 0, 0.2);
gui.add(meta, '播放');
gui.add(meta, '时间 (2016-11-20+h)', 0, HOURS, 0.1).onChange(function (value) {
    hour = value;
}).listen();
gui.add(meta, '播放速度', 0.5, 6);
gui.add(meta, 'retina resolution').onFinishChange(resizeCanvas);
gui.add(meta, 'github.com/mapbox/webgl-wind');

// ---------------------------------------------------------------------------
// hover readout: wind speed and direction under the cursor
canvas.addEventListener('mousemove', function (e) {
    if (pairIndex < 0 || !windFields[pairIndex]) {
        hoverEl.hidden = true;
        return;
    }
    const bounds = viewBounds();
    const mx = bounds[0] + e.clientX / canvas.clientWidth * (bounds[2] - bounds[0]);
    const my = bounds[1] + e.clientY / canvas.clientHeight * (bounds[3] - bounds[1]);
    if (mx < 0 || mx > 1 || my < 0 || my > 1) {
        hoverEl.hidden = true;
        return;
    }
    const lat = mercatorToLat(my);
    const lon = mx * 360 - 180;
    const t = wind.windInterpolation;
    const a = sampleWind(windFields[pairIndex], mx, lat);
    const b = sampleWind(windFields[pairIndex + 1], mx, lat);
    const u = a[0] + (b[0] - a[0]) * t;
    const v = a[1] + (b[1] - a[1]) * t;
    const speed = Math.sqrt(u * u + v * v);
    // meteorological convention: the direction the wind is coming FROM
    const dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;

    hoverEl.textContent =
        formatLon(lon) + ' ' + formatLat(lat) + '\n' +
        '风速 ' + speed.toFixed(1) + ' m/s\n' +
        '风向 ' + dir.toFixed(0) + '° ' + compass(dir);
    hoverEl.hidden = false;
});
canvas.addEventListener('mouseleave', function () {
    hoverEl.hidden = true;
});

// bilinear wind sample at a mercator world position, decoded from the wind PNG
function sampleWind(windData, mx, lat) {
    const px = windData.pixels;
    const x = mx * px.width - 0.5;
    const y = (90 - lat) / 180 * px.height - 0.5;
    const x0 = Math.min(Math.max(Math.floor(x), 0), px.width - 1);
    const y0 = Math.min(Math.max(Math.floor(y), 0), px.height - 1);
    const x1 = Math.min(x0 + 1, px.width - 1);
    const y1 = Math.min(y0 + 1, px.height - 1);
    const fx = Math.min(Math.max(x - x0, 0), 1);
    const fy = Math.min(Math.max(y - y0, 0), 1);

    let u = 0;
    let v = 0;
    for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= 1; i++) {
            const k = ((j ? y1 : y0) * px.width + (i ? x1 : x0)) * 4;
            const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
            u += w * (windData.uMin + px.data[k] / 255 * (windData.uMax - windData.uMin));
            v += w * (windData.vMin + px.data[k + 1] / 255 * (windData.vMax - windData.vMin));
        }
    }
    return [u, v];
}

function decodeWindImage(image) {
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return {
        data: ctx.getImageData(0, 0, c.width, c.height).data,
        width: c.width,
        height: c.height
    };
}

// ---------------------------------------------------------------------------
// coastline, drawn from a local GeoJSON copy (no external CDN)
let coastline = null;
getJSON('coastline.geojson', function (data) {
    coastline = data;
    drawCoastline();
});

function drawCoastline() {
    if (!coastline) return;
    const ctx = coastlineCanvas.getContext('2d');
    const w = coastlineCanvas.width;
    const h = coastlineCanvas.height;
    const bounds = viewBounds();
    const sx = w / (bounds[2] - bounds[0]);
    const sy = h / (bounds[3] - bounds[1]);

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = getPxRatio();
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'white';
    ctx.beginPath();

    for (let i = 0; i < coastline.features.length; i++) {
        const line = coastline.features[i].geometry.coordinates;
        for (let j = 0; j < line.length; j++) {
            const x = (line[j][0] + 180) / 360;
            const y = latToMercator(line[j][1]);
            ctx[j ? 'lineTo' : 'moveTo']((x - bounds[0]) * sx, (y - bounds[1]) * sy);
        }
    }
    ctx.stroke();
}

// ---------------------------------------------------------------------------
// canvas sizing: keep the particle state across resizes and pixel-ratio changes
function resizeCanvas() {
    const ratio = meta['retina resolution'] ? pxRatio : 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    coastlineCanvas.width = canvas.clientWidth * pxRatio;
    coastlineCanvas.height = canvas.clientHeight * pxRatio;
    wind.resize(); // preserves particle state and trails
    applyView();
}

window.addEventListener('resize', resizeCanvas);

// re-render when the page moves to a screen with a different pixel ratio
function watchPixelRatio() {
    const query = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
    const onChange = function () {
        pxRatio = getPxRatio();
        resizeCanvas();
        watchPixelRatio();
    };
    if (query.addEventListener) {
        query.addEventListener('change', onChange, {once: true});
    } else {
        query.addListener(onChange); // older Safari
    }
}

function getPxRatio() {
    return Math.max(Math.floor(window.devicePixelRatio) || 1, 2);
}

// ---------------------------------------------------------------------------
// web-mercator helpers
function latToMercator(lat) {
    const clamped = Math.min(Math.max(lat, -85.05112878), 85.05112878);
    const phi = clamped * Math.PI / 180;
    return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
}

function mercatorToLat(y) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

function compass(deg) {
    const names = ['北', '北东北', '东北', '东东北', '东', '东东南', '东南', '南东南',
        '南', '南西南', '西南', '西西南', '西', '西西北', '西北', '北西北'];
    return names[Math.round(deg / 22.5) % 16] + '风';
}

function formatLon(lon) {
    return Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W');
}

function formatLat(lat) {
    return Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S');
}

function getJSON(url, callback) {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.open('get', url, true);
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            callback(xhr.response);
        } else {
            throw new Error(xhr.statusText);
        }
    };
    xhr.send();
}

// ---------------------------------------------------------------------------
resizeCanvas();
watchPixelRatio();
requestAnimationFrame(frame);
