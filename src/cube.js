
function spinning_cube() {
  const canvas = document.getElementById('cube-canvas');
  const gl = canvas.getContext('webgl');

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const posData = new Float32Array([
    1.0,  1.0,  1.0, 
    -1.0,  1.0,  1.0, 
    -1.0, -1.0,  1.0, 
    1.0, -1.0,  1.0, 
    1.0, -1.0, -1.0, 
    1.0,  1.0, -1.0, 
    -1.0,  1.0, -1.0, 
    -1.0, -1.0, -1.0 
  ]); 

  const indData = new Uint16Array([
    0, 1, 2,   0, 2, 3,  // front
    0, 3, 4,   0, 4, 5,  // right
    0, 5, 6,   0, 6, 1,  // up
    1, 6, 7,   1, 7, 2,  // left
    7, 4, 3,   7, 3, 2,  // down
    4, 7, 6,   4, 6, 5   // back
  ]);

  const colData = new Float32Array([
    1.0,  1.0,  1.0,  // v0 white
    1.0,  0.0,  1.0,  // v1 magenta
    1.0,  0.0,  0.0,  // v2 red
    1.0,  1.0,  0.0,  // v3 yellow
    0.0,  1.0,  0.0,  // v4 green
    0.0,  1.0,  1.0,  // v5 cyan
    0.0,  0.0,  1.0,  // v6 blue
    0.0,  0.0,  0.0   // v7 black
  ]);


  let vertexShader = gl.createShader(gl.VERTEX_SHADER);
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

  let fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, `
  precision mediump float;
  varying vec4 v_color;
  void main() {
    gl_FragColor = v_color;
  }
  `);
  gl.compileShader(fragmentShader);

  let program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);


  let positionBuffer = array_buffer(gl, posData, program, 'position', 3, gl.FLOAT);
  let indexBuffer = element_array_buffer(gl, indData);
  let colorBuffer = array_buffer(gl, colData, program, 'color', 3, gl.FLOAT);


  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);

  let uniformLocations = {
    matrix: gl.getUniformLocation(program, 'matrix'),
  };

  let projectionMatrix = glMatrix.mat4.create();
  glMatrix.mat4.perspective(projectionMatrix,
    75 * Math.PI/180,
    canvas.width/canvas.height,
    1e-4,
    1e4
  );

  let mvpMatrix = glMatrix.mat4.create();
  let mvMatrix = glMatrix.mat4.create();
  let modelMatrix = glMatrix.mat4.create();
  camera = new CameraHandler(canvas, 4);
  let viewMatrix = camera.view_matrix;
  glMatrix.mat4.translate(modelMatrix, modelMatrix, [0, 0, 0]); 
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  let UI_demo = {
    spin: false,
    lighting: false,
    perspective: true,
  };

  function animate() {
    requestAnimationFrame(animate);
    
    if (UI_demo.spin) {
      glMatrix.mat4.rotateZ(modelMatrix, modelMatrix, Math.PI/2/70);
      glMatrix.mat4.rotateX(modelMatrix, modelMatrix, Math.PI/2/70);
    }

    glMatrix.mat4.multiply(mvMatrix, viewMatrix, modelMatrix);
    glMatrix.mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix);

    if (UI_demo.perspective) {
      gl.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix);
    } else {
      gl.uniformMatrix4fv(uniformLocations.matrix, false, mvMatrix);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, indData.length, gl.UNSIGNED_SHORT, 0);
  }

  animate();

}

spinning_cube();