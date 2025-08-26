const canvas = document.getElementById('webgl-canvas');
const gl = canvas.getContext('webgl');

if (!gl) {
  throw new Error('WebGL not supported');
}

const vertexData = new Float32Array([
  // Front
  1.0, 1.0, 1.0,
  1.0, -1.0, 1.0,
  -1.0, 1.0, 1.0,
  -1.0, 1.0, 1.0,
  1.0, -1.0, 1.0,
  -1.0, -1.0, 1.0,

  // Left
  -1.0, 1.0, 1.0,
  -1.0, -1.0, 1.0,
  -1.0, 1.0, -1.0,
  -1.0, 1.0, -1.0,
  -1.0, -1.0, 1.0,
  -1.0, -1.0, -1.0,

  // Top
  1.0, 1.0, 1.0,
  1.0, 1.0, -1.0,
  -1.0, 1.0, 1.0,
  -1.0, 1.0, 1.0,
  1.0, 1.0, -1.0,
  -1.0, 1.0, -1.0,

  // Back
  -1.0, 1.0, -1.0,
  -1.0, -1.0, -1.0,
  1.0, 1.0, -1.0,
  1.0, 1.0, -1.0,
  -1.0, -1.0, -1.0,
  1.0, -1.0, -1.0,

  //  Right
  1.0, 1.0, -1.0,
  1.0, -1.0, -1.0,
  1.0, 1.0, 1.0,
  1.0, 1.0, 1.0,
  1.0, -1.0, 1.0,
  1.0, -1.0, -1.0,

  // Bottom
  1.0, -1.0, 1.0,
  1.0, -1.0, -1.0,
  -1.0, -1.0, 1.0,
  -1.0, -1.0, 1.0,
  1.0, -1.0, -1.0,
  -1.0, -1.0, -1.0

]);

const colorData = new Float32Array([
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  1.0, 1.0, 0.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  0.0, 1.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0,
  1.0, 0.0, 1.0
]);

var FSIZE = vertexData.BYTES_PER_ELEMENT;

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

const colorBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.STATIC_DRAW);

const vertexShader = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vertexShader, `
attribute vec3 position;
attribute vec4 color;
varying vec4 v_color;

uniform mat4 matrix;

void main() {
  gl_Position = matrix * vec4(position, 1);
  v_color = color;
}
`);
gl.compileShader(vertexShader);

const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fragmentShader, `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = v_color;
}
`);
gl.compileShader(fragmentShader);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

const positionLocation = gl.getAttribLocation(program, 'position');
gl.enableVertexAttribArray(positionLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

var color = gl.getAttribLocation(program, 'color');
gl.enableVertexAttribArray(color);
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 0, 0);

gl.useProgram(program);
gl.enable(gl.DEPTH_TEST);

const uniformLocations = {
  matrix: gl.getUniformLocation(program, 'matrix'),
};

const matrix = glMatrix.mat4.create();
glMatrix.mat4.scale(matrix, matrix, [0.5, 0.5, 0.5]);

gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);

function animate() {
  requestAnimationFrame(animate);
  
  glMatrix.mat4.rotateZ(matrix, matrix, Math.PI/2/70);
  glMatrix.mat4.rotateX(matrix, matrix, Math.PI/2/70);
  gl.uniformMatrix4fv(uniformLocations.matrix, false, matrix);
  
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, vertexData.length / 3);
}

animate();
