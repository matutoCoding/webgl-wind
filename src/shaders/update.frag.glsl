precision highp float;

uniform sampler2D u_particles;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform vec2 u_wind_res;
uniform vec2 u_wind_min0;
uniform vec2 u_wind_max0;
uniform vec2 u_wind_min1;
uniform vec2 u_wind_max1;
uniform float u_wind_interp;
uniform float u_rand_seed;
uniform float u_speed_factor;
uniform float u_drop_rate;
uniform float u_drop_rate_bump;

// particle positions are stored relative to this bbox (minX, minY, sizeX, sizeY),
// in web-mercator world coordinates; it tracks the view with some padding
uniform vec4 u_bbox;

varying vec2 v_tex_pos;

const float PI = 3.141592653589793;

// pseudo-random generator
const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) {
    float t = dot(rand_constants.xy, co);
    return fract(sin(t) * (rand_constants.z + t));
}

// web-mercator world position -> wind data texture coordinates (equirectangular)
vec2 merc_to_uv(const vec2 p) {
    float m = PI * (1.0 - 2.0 * p.y);
    float lat = atan(0.5 * (exp(m) - exp(-m)));
    return vec2(p.x, 0.5 - lat / PI);
}

// wind speed lookup; use manual bilinear filtering based on 4 adjacent pixels for smooth interpolation
vec2 lookup_wind(const sampler2D wind, const vec2 uv) {
    vec2 px = 1.0 / u_wind_res;
    vec2 vc = (floor(uv * u_wind_res)) * px;
    vec2 f = fract(uv * u_wind_res);
    vec2 tl = texture2D(wind, vc).rg;
    vec2 tr = texture2D(wind, vc + vec2(px.x, 0)).rg;
    vec2 bl = texture2D(wind, vc + vec2(0, px.y)).rg;
    vec2 br = texture2D(wind, vc + px).rg;
    return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);
}

void main() {
    vec4 color = texture2D(u_particles, v_tex_pos);
    vec2 pos = vec2(
        color.r / 255.0 + color.b,
        color.g / 255.0 + color.a); // decode particle position from pixel RGBA

    // global web-mercator position of the particle
    vec2 global_pos = u_bbox.xy + pos * u_bbox.zw;
    vec2 uv = merc_to_uv(global_pos);

    // interpolate between the two surrounding time steps on the GPU
    vec2 velocity = mix(
        mix(u_wind_min0, u_wind_max0, lookup_wind(u_wind0, uv)),
        mix(u_wind_min1, u_wind_max1, lookup_wind(u_wind1, uv)),
        u_wind_interp);
    float speed_t = length(velocity) / length(mix(u_wind_max0, u_wind_max1, u_wind_interp));

    // Web-mercator is conformal, so a local displacement is isotropic and no
    // latitude distortion correction is needed. The offset is scaled with the
    // view width so that the apparent speed stays the same at any zoom level;
    // since positions are stored relative to u_bbox, the zoom factor cancels
    // out and only the bbox padding remains.
    vec2 offset = vec2(velocity.x, -velocity.y) * 0.0001 * u_speed_factor *
        u_bbox.z / u_bbox.zw;

    // update particle position; particles leaving the bbox are respawned below
    pos = pos + offset;

    // a random seed to use for the particle drop
    vec2 seed = (pos + v_tex_pos) * u_rand_seed;

    // drop rate is a chance a particle will restart at random position, to avoid degeneration
    float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;
    float drop = step(1.0 - drop_rate, rand(seed));

    // force a respawn for particles that drifted out of the reference bbox
    vec2 in_bounds = step(vec2(0.0), pos) * step(pos, vec2(1.0));
    drop = max(drop, 1.0 - in_bounds.x * in_bounds.y);

    vec2 random_pos = vec2(
        rand(seed + 1.3),
        rand(seed + 2.1));
    pos = mix(pos, random_pos, drop);

    // encode the new particle position back into RGBA
    gl_FragColor = vec4(
        fract(pos * 255.0),
        floor(pos * 255.0) / 255.0);
}
