precision mediump float;

uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform vec2 u_wind_min0;
uniform vec2 u_wind_max0;
uniform vec2 u_wind_min1;
uniform vec2 u_wind_max1;
uniform float u_wind_interp;
uniform sampler2D u_color_ramp;

varying vec2 v_particle_pos;

const float PI = 3.141592653589793;

// web-mercator world position -> wind data texture coordinates (equirectangular)
vec2 merc_to_uv(const vec2 p) {
    float m = PI * (1.0 - 2.0 * p.y);
    float lat = atan(0.5 * (exp(m) - exp(-m)));
    return vec2(p.x, 0.5 - lat / PI);
}

void main() {
    vec2 uv = merc_to_uv(v_particle_pos);

    // interpolate between the two surrounding time steps on the GPU
    vec2 velocity = mix(
        mix(u_wind_min0, u_wind_max0, texture2D(u_wind0, uv).rg),
        mix(u_wind_min1, u_wind_max1, texture2D(u_wind1, uv).rg),
        u_wind_interp);
    float speed_t = length(velocity) / length(mix(u_wind_max0, u_wind_max1, u_wind_interp));

    // color ramp is encoded in a 16x16 texture
    vec2 ramp_pos = vec2(
        fract(16.0 * speed_t),
        floor(16.0 * speed_t) / 16.0);

    gl_FragColor = texture2D(u_color_ramp, ramp_pos);
}
