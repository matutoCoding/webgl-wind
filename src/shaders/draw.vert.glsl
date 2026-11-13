precision mediump float;

attribute float a_index;

uniform sampler2D u_particles;
uniform float u_particles_res;

// particle positions are stored relative to u_bbox (minX, minY, sizeX, sizeY),
// in web-mercator world coordinates (0..1 across the whole world)
uniform vec4 u_bbox;
// currently visible part of the world, same coordinate space
uniform vec4 u_view;

varying vec2 v_particle_pos;

void main() {
    vec4 color = texture2D(u_particles, vec2(
        fract(a_index / u_particles_res),
        floor(a_index / u_particles_res) / u_particles_res));

    // decode current particle position from the pixel's RGBA value
    vec2 pos = vec2(
        color.r / 255.0 + color.b,
        color.g / 255.0 + color.a);

    // global web-mercator position of the particle
    v_particle_pos = u_bbox.xy + pos * u_bbox.zw;

    vec2 clip = (v_particle_pos - u_view.xy) / u_view.zw;

    gl_PointSize = 1.0;
    gl_Position = vec4(2.0 * clip.x - 1.0, 1.0 - 2.0 * clip.y, 0, 1);
}
