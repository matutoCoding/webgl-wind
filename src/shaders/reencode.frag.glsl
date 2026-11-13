precision highp float;

uniform sampler2D u_particles;

// previous and new reference bboxes (minX, minY, sizeX, sizeY),
// in web-mercator world coordinates
uniform vec4 u_prev_bbox;
uniform vec4 u_bbox;
uniform float u_rand_seed;

varying vec2 v_tex_pos;

// pseudo-random generator
const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) {
    float t = dot(rand_constants.xy, co);
    return fract(sin(t) * (rand_constants.z + t));
}

void main() {
    vec4 color = texture2D(u_particles, v_tex_pos);
    vec2 pos = vec2(
        color.r / 255.0 + color.b,
        color.g / 255.0 + color.a); // decode particle position from pixel RGBA

    // keep the same global web-mercator position, re-encoded against the new bbox
    vec2 global_pos = u_prev_bbox.xy + pos * u_prev_bbox.zw;
    pos = (global_pos - u_bbox.xy) / u_bbox.zw;

    // particles that fall outside the new bbox restart at a random place inside it
    vec2 seed = (pos + v_tex_pos) * u_rand_seed;
    vec2 in_bounds = step(vec2(0.0), pos) * step(pos, vec2(1.0));
    float outside = 1.0 - in_bounds.x * in_bounds.y;
    vec2 random_pos = vec2(
        rand(seed + 1.3),
        rand(seed + 2.1));
    pos = mix(pos, random_pos, outside);

    // encode the new particle position back into RGBA
    gl_FragColor = vec4(
        fract(pos * 255.0),
        floor(pos * 255.0) / 255.0);
}
