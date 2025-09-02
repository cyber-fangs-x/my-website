initialize = (canvas) => {
  const gl = canvas.getContext('webgl');

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  return gl;
}

//################## BUFFER HELPERS ##################################

array_buffer = (gl, data, program, attribute, size, type) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const attributeLocation = gl.getAttribLocation(program, attribute);
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, size, type, false, 0, 0);
    return buffer;
}

update_buffer = (gl, buffer, data) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

element_array_buffer = (gl, data) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
}
element_array_buffer_update = (gl, buffer, data) => {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

set_uniform_matrix4fv = (gl, program, uniform, matrix) => {
    const uniformLocation = gl.getUniformLocation(program, uniform);
    gl.uniformMatrix4fv(uniformLocation, false, matrix);
}

//################## SHADER HELPERS ##################################

check_shader_compile_status = (gl, shader) => {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        throw new Error('Could not compile WebGL program. \n\n' + info);
    }
}
