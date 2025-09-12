//import { GeometryHandler } from './geometry-handler.js';

function bunny_demo() {
  const canvas = document.getElementById('webgl-canvas');
  const gl = canvas.getContext('webgl');
  const ext = gl.getExtension("OES_element_index_uint");

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  // ################## OBJECT STUFF ##################################

  let object = new GeometryHandler(bunny);
  let camera = new CameraHandler(canvas, 1.5);
  let positions = object.vertices;
  let indices = object.faces;
  let colors = object.colors;
  let normals = object.normals;

  // ################## WEBGL STUFF ##################################

  let vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, `
  attribute vec3 position;
  attribute vec4 color;
  attribute vec3 normal;
  varying vec4 v_color;
  varying float v_light;

  const vec3 light_dir = normalize(vec3(0, 1, 1));
  const float ambient = 0.1;

  uniform mat4 matrix;
  uniform mat4 normal_matrix;

  void main() {
    vec3 world_normal = normalize((normal_matrix * vec4(normal, 0)).xyz);
    v_light = max(dot(world_normal, light_dir), 0.0) * (1.0 - ambient) + ambient;
    gl_Position = matrix * vec4(position, 1);
    v_color = color;
  }
  `);
  gl.compileShader(vertexShader);

  let fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, `
  precision mediump float;
  varying vec4 v_color;
  varying float v_light;
  void main() {
    gl_FragColor = v_color * vec4(vec3(v_light), 1.0);
  }
  `);
  gl.compileShader(fragmentShader);

  let program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);


  //const positionBuffer = array_buffer(gl, vertexData, program, 'position', 3, gl.FLOAT);
  let positionBuffer = array_buffer(gl, positions, program, 'position', 3, gl.FLOAT);
  let indexBuffer = element_array_buffer(gl, indices);
  let normalBuffer = array_buffer(gl, normals, program, 'normal', 3, gl.FLOAT);
  let colorBuffer = array_buffer(gl, colors, program, 'color', 3, gl.FLOAT);


  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);

  let uniformLocations = {
    matrix: gl.getUniformLocation(program, 'matrix'),
    normal_matrix: gl.getUniformLocation(program, 'normal_matrix')
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
  let viewMatrix = camera.view_matrix;
  let normalMatrix = glMatrix.mat4.create();
  
  //glMatrix.mat4.translate(modelMatrix, modelMatrix, [0, 0, 0]); 
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);


  function animate() {
    requestAnimationFrame(animate);
  
    // MVP matrix
    glMatrix.mat4.multiply(mvMatrix, viewMatrix, modelMatrix);
    glMatrix.mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix);

    // normal matrix
    glMatrix.mat4.invert(normalMatrix, mvMatrix);
    glMatrix.mat4.transpose(normalMatrix, normalMatrix);

    gl.uniformMatrix4fv(uniformLocations.normal_matrix, false, normalMatrix);
    gl.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix);
    
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
  }

  animate(); 
}

bunny_demo();