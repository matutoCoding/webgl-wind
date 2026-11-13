// inline replacement for rollup-plugin-string (not available on our registry):
// imports .glsl shader sources as plain strings
function glsl() {
    return {
        name: 'glsl-string',
        transform(code, id) {
            if (!/\.glsl$/.test(id)) return null;
            return {
                code: `export default ${JSON.stringify(code)};`,
                map: {mappings: ''}
            };
        }
    };
}

export default {
    input: 'src/index.js',
    output: {
        file: 'dist/wind-gl.js',
        format: 'umd',
        name: 'WindGL'
    },
    plugins: [glsl()]
};
