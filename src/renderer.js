const canvas = document.getElementById('webgl-canvas');
const gl = canvas.getContext('webgl');
const ext = gl.getExtension("OES_element_index_uint");

if (!gl) {
  throw new Error('WebGL not supported');
}

const vs = new Float32Array([
  1.0,  1.0,  1.0, 
  -1.0,  1.0,  1.0, 
  -1.0, -1.0,  1.0, 
  1.0, -1.0,  1.0, 
  1.0, -1.0, -1.0, 
  1.0,  1.0, -1.0, 
  -1.0,  1.0, -1.0, 
  -1.0, -1.0, -1.0 
]); 

const fs = new Uint16Array([
  0, 1, 2,   0, 2, 3,  // front
  0, 3, 4,   0, 4, 5,  // right
  0, 5, 6,   0, 6, 1,  // up
  1, 6, 7,   1, 7, 2,  // left
  7, 4, 3,   7, 3, 2,  // down
  4, 7, 6,   4, 6, 5   // back
]);

const colorData = new Float32Array([
  1.0,  1.0,  1.0,  // v0 white
  1.0,  0.0,  1.0,  // v1 magenta
  1.0,  0.0,  0.0,  // v2 red
  1.0,  1.0,  0.0,  // v3 yellow
  0.0,  1.0,  0.0,  // v4 green
  0.0,  1.0,  1.0,  // v5 cyan
  0.0,  0.0,  1.0,  // v6 blue
  0.0,  0.0,  0.0   // v7 black
]);


function initMesh(text) {
  const ORANGE = new Vector(1.0, 0.5, 0.0);
  let polygonSoup = MeshIO.readOBJ(text);
  mesh = new Mesh();
  if (mesh.build(polygonSoup)) {
    // create geometry object, normalized
    geometry = new Geometry(mesh, polygonSoup["v"]);
    console.log("Mesh loaded");
  } else {
    alert("Unable to build halfedge mesh");
  }
  // fill position, normal and color buffers
  let V = mesh.vertices.length;
  positions = new Float32Array(V * 3);
  normals = new Float32Array(V * 3);
  colors = new Float32Array(V * 3);
  for (let v of mesh.vertices) {
    let i = v.index;

    let position = geometry.positions[v];
    positions[3 * i + 0] = position.x;
    positions[3 * i + 1] = position.y;
    positions[3 * i + 2] = position.z;

    let normal = geometry.vertexNormalEquallyWeighted(v);
    normals[3 * i + 0] = normal.x;
    normals[3 * i + 1] = normal.y;
    normals[3 * i + 2] = normal.z;

    colors[3 * i + 0] = normal.x;
    colors[3 * i + 1] = normal.y;
    colors[3 * i + 2] = 1.0;
  }

  // fill index buffer
  let F = mesh.faces.length;
  indices = new Uint32Array(F * 3);
  for (let f of mesh.faces) {
    let i = 0;
    for (let v of f.adjacentVertices()) {
      indices[3 * f.index + i++] = v.index;
    }
  }
}

initMesh(bunny);
console.log(indices.length);
console.log(indices);

// ################## WEBGL STUFF ##################################

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


//const positionBuffer = array_buffer(gl, vertexData, program, 'position', 3, gl.FLOAT);
const positionBuffer = array_buffer(gl, positions, program, 'position', 3, gl.FLOAT);
const indexBuffer = element_array_buffer(gl, indices);

const colorBuffer = array_buffer(gl, colors, program, 'color', 3, gl.FLOAT);


gl.useProgram(program);
gl.enable(gl.DEPTH_TEST);

const uniformLocations = {
  matrix: gl.getUniformLocation(program, 'matrix'),
};

const projectionMatrix = glMatrix.mat4.create();
glMatrix.mat4.perspective(projectionMatrix,
  75 * Math.PI/180,
  canvas.width/canvas.height,
  1e-4,
  1e4
);

const mvpMatrix = glMatrix.mat4.create();
const mvMatrix = glMatrix.mat4.create();
const modelMatrix = glMatrix.mat4.create();
const viewMatrix = glMatrix.mat4.create();
glMatrix.mat4.translate(viewMatrix, viewMatrix, [0, 0, -2]);
//glMatrix.mat4.invert(viewMatrix, viewMatrix);
glMatrix.mat4.translate(modelMatrix, modelMatrix, [0, 0, 0]); 
//glMatrix.mat4.scale(modelMatrix, modelMatrix, [0.5, 0.5, 0.5]);
gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);

//glMatrix.mat4.translate(modelMatrix, modelMatrix, [-1.5, 0, -2]);

function animate() {
  requestAnimationFrame(animate);
 
  glMatrix.mat4.rotateZ(modelMatrix, modelMatrix, Math.PI/2/70);
  glMatrix.mat4.rotateX(modelMatrix, modelMatrix, Math.PI/2/70);
  glMatrix.mat4.multiply(mvMatrix, viewMatrix, modelMatrix);
  glMatrix.mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix);
  gl.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix);
  
  gl.clear(gl.COLOR_BUFFER_BIT);
  //gl.drawArrays(gl.TRIANGLES, 0, vertexData.length / 3);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
}

//animate();

// ################################ SANDBOX ################################
// Animation parameters
// let startTime = Date.now();
// let animationDuration = 5000; // 2 seconds for 90-degree rotation
// let startAngle = 0;
// let endAngle = Math.PI / 2; // 90 degrees in radians
// let radius = 3; // Distance from origin

// function updateCamera() {
//     let currentTime = Date.now();
//     let elapsed = currentTime - startTime;
//     let progress = Math.min(elapsed / animationDuration, 1.0);
    
//     // Smooth easing (optional)
//     progress = progress * progress * (3 - 2 * progress); // smoothstep
    
//     // Interpolate angle
//     let currentAngle = startAngle + (endAngle - startAngle) * progress;
    
//     // Calculate new camera position
//     let cameraX = radius * Math.sin(currentAngle);
//     let cameraY = 0; // Y stays constant since we're rotating around Y-axis
//     let cameraZ = radius * Math.cos(currentAngle);
    
//     // Create view matrix
//     let viewMatrix = glMatrix.mat4.create();
//     glMatrix.mat4.lookAt(viewMatrix, 
//                 [cameraX, cameraY, cameraZ], // camera position
//                 [0, 0, 0],                   // look at origin
//                 [0, 1, 0]);                  // up vector

//     return { viewMatrix, isComplete: progress >= 1.0 };
// }

// // In your render loop
// function render() {
//     let { viewMatrix, isComplete } = updateCamera();
    
//     // Use viewMatrix for rendering
//     glMatrix.mat4.multiply(mvMatrix, viewMatrix, modelMatrix);
//     glMatrix.mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix);
//     gl.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix);
//     gl.clear(gl.COLOR_BUFFER_BIT);
//     gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    
//     // Continue animation if not complete
//     if (!isComplete) {
//         requestAnimationFrame(render);
//     }
// }
 //############################### END SANDBOX ################################
 // Animation parameters
let startTime = Date.now();
let animationDuration = 4000; // 4 seconds total animation
let yRotationDuration = 2000; // First 2 seconds for Y rotation
let zRotationDuration = 2000; // Next 2 seconds for Z rotation
let radius = 2; // Distance from origin

// Create initial quaternion (identity rotation at starting position)
function createInitialQuaternion() {
    // Initial camera at (0, 0, 3) looking at origin
    // This represents no rotation from the initial state
    return glMatrix.quat.create(); // Identity quaternion
}

// Create quaternion for Y-axis rotation
function createYRotationQuaternion(angle) {
    let quat_y = glMatrix.quat.create();
    glMatrix.quat.setAxisAngle(quat_y, [0, 1, 0], angle); // Rotate around Y-axis
    return quat_y;
}

// Create quaternion for Z-axis rotation
function createZRotationQuaternion(angle) {
    let quat_z = glMatrix.quat.create();
    glMatrix.quat.setAxisAngle(quat_z, [0, 0, 1], angle); // Rotate around Z-axis
    return quat_z;
}

// Convert quaternion rotation to camera position
function quaternionToCameraPosition(rotation, distance) {
    // Start with base camera position (0, 0, distance)
    let basePosition = glMatrix.vec3.fromValues(0, 0, distance);
    
    // Apply the rotation to get new camera position
    let cameraPosition = glMatrix.vec3.create();
    glMatrix.vec3.transformQuat(cameraPosition, basePosition, rotation);
    
    return cameraPosition;
}

// Smooth easing function
function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

// function updateCamera() {
//     let currentTime = Date.now();
//     let elapsed = currentTime - startTime;
//     let totalProgress = Math.min(elapsed / animationDuration, 1.0);
    
//     // Determine which phase of animation we're in
//     let yProgress = 0;
//     let zProgress = 0;
    
//     if (elapsed <= yRotationDuration) {
//         // Phase 1: Y rotation (0 to 2 seconds)
//         yProgress = smoothstep(elapsed / yRotationDuration);
//         zProgress = 0;
//     } else {
//         // Phase 2: Z rotation (2 to 4 seconds)
//         yProgress = 1; // Y rotation complete
//         let zElapsed = elapsed - yRotationDuration;
//         zProgress = smoothstep(zElapsed / zRotationDuration);
//     }
    
//     // Create individual rotation quaternions
//     let yAngle = (Math.PI / 2) * yProgress; // 0 to 90 degrees
//     let zAngle = (Math.PI / 4) * zProgress; // 0 to 45 degrees
    
//     let quat_y = createYRotationQuaternion(yAngle);
//     let quat_z = createZRotationQuaternion(zAngle);
    
//     // Combine rotations: first Y, then Z
//     // Note: quaternion multiplication order matters!
//     // We want to apply Y rotation first, then Z rotation
//     let combinedRotation = glMatrix.quat.create();
//     glMatrix.quat.multiply(combinedRotation, quat_z, quat_y);
    
//     // Convert to camera position
//     let cameraPosition = quaternionToCameraPosition(combinedRotation, radius);
    
//     // Calculate up vector (also needs to be rotated)
//     let baseUp = glMatrix.vec3.fromValues(0, 1, 0);
//     let rotatedUp = glMatrix.vec3.create();
//     vec3.transformQuat(rotatedUp, baseUp, combinedRotation);
    
//     // Create view matrix
//     let viewMatrix = glMatrix.mat4.create();
//     mat4.lookAt(viewMatrix, 
//                 cameraPosition,    // camera position
//                 [0, 0, 0],        // look at origin (cube position)
//                 rotatedUp);       // rotated up vector
    
//     return { 
//         viewMatrix, 
//         isComplete: totalProgress >= 1.0,
//         cameraPosition: cameraPosition,
//         phase: elapsed <= yRotationDuration ? 'Y-rotation' : 'Z-rotation'
//     };
// }

// Alternative version with smooth interpolation between the two rotations
function updateCameraSmooth() {
    let currentTime = Date.now();
    let elapsed = currentTime - startTime;
    let progress = Math.min(elapsed / animationDuration, 1.0);
    let smoothProgress = smoothstep(progress);
    
    // Define start and end rotations
    let startQuat = createInitialQuaternion(); // Identity (no rotation)
    
    // End rotation: 90° around Y, then 45° around Z
    let endYQuat = createYRotationQuaternion(Math.PI / 2);
    let endZQuat = createZRotationQuaternion(Math.PI / 4);
    let endQuat = glMatrix.quat.create();
    glMatrix.quat.multiply(endQuat, endZQuat, endYQuat);
    
    // Spherical linear interpolation between start and end
    let currentRotation = glMatrix.quat.create();
    glMatrix.quat.slerp(currentRotation, startQuat, endQuat, smoothProgress);
    
    // Convert to camera position
    let cameraPosition = quaternionToCameraPosition(currentRotation, radius);
    
    // Calculate up vector
    let baseUp = glMatrix.vec3.fromValues(0, 1, 0);
    let rotatedUp = glMatrix.vec3.create();
    glMatrix.vec3.transformQuat(rotatedUp, baseUp, currentRotation);
    
    // Create view matrix
    let viewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.lookAt(viewMatrix, 
                cameraPosition,
                [0, 0, 0],
                rotatedUp);
    
    return { 
        viewMatrix, 
        isComplete: progress >= 1.0,
        cameraPosition: cameraPosition
    };
}

// In your render loop
function render() {
    // Choose between sequential rotations or smooth interpolation
    let { viewMatrix, isComplete, cameraPosition, phase } = updateCameraSmooth();
    // OR use: let { viewMatrix, isComplete, cameraPosition } = updateCameraSmooth();
    
    // Use viewMatrix for rendering
    glMatrix.mat4.multiply(mvMatrix, viewMatrix, modelMatrix);
    glMatrix.mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix);
    gl.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    
    // Optional: log current state for debugging
    if (phase) {
        console.log(`Phase: ${phase}, Camera: (${cameraPosition[0].toFixed(2)}, ${cameraPosition[1].toFixed(2)}, ${cameraPosition[2].toFixed(2)})`);
    }
    
    // Continue animation if not complete
    if (!isComplete) {
        requestAnimationFrame(render);
    }
}

render();

// function createRotationQuaternion(axis, angle) {
//     let quat_rot = quat.create();
//     quat.setAxisAngle(quat_rot, axis, angle);
//     return quat_rot;
// }

// // Convenience functions for common cases
// const createXRotationQuaternion = (angle) => createRotationQuaternion([1,0,0], angle);
// const createYRotationQuaternion = (angle) => createRotationQuaternion([0,1,0], angle);
// const createZRotationQuaternion = (angle) => createRotationQuaternion([0,0,1], angle);