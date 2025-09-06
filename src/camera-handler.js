"use strict";

const WORLD_UP = glMatrix.vec3.fromValues(0, 1, 0);
const ROTATION_SPEED = 0.01;

class CameraHandler {
    /**
	 * This class handles the camera view matrix and parameters for rendering.
	 * @constructor module:webgl.CameraHandler
     * @param {number} distance - The OBJ file content as a string.
	 * @property {[]} target - The point the camera is looking at.
     * @property {number} distance - The distance from the camera to the target point.
     * @property {quat} yaw_quat - The yaw rotation as a quaternion.
     * @property {quat} pitch_quat - The pitch rotation as a quaternion.
     * @property {quat} temp_quat - A temporary quaternion for calculations.
     * @property {quat} orientation - The camera's orientation as a quaternion.
     * @property {mat4} view_matrix - The view matrix for rendering.
	 * @property {boolean} mousedown - Whether the mouse is currently pressed.
     * @property {number} mouse_pos - The last recorded mouse position.
	 */
    constructor(distance) {
        // camera parameters
        this.target = [0, 0, 0];
        this.distance = distance;
        this.yaw_quat = glMatrix.quat.create();
        this.pitch_quat = glMatrix.quat.create();
        this.temp_quat = glMatrix.quat.create();
        this.orientation = glMatrix.quat.create();
        this.camera_pos = glMatrix.vec3.fromValues(0, 0, distance);
        this.view_matrix = glMatrix.mat4.lookAt(glMatrix.mat4.create(), this.camera_pos, this.target, WORLD_UP);
        
        // mouse interaction state
        this.mousedown = false;
        this.mouse_pos = [0, 0];

        this.setCameraEvents();
    }

    /**
	 * Sets up the event listeners for updating the camera's orientation.
	 * @method module:webgl.CameraHandler#setCameraEvents
	 */
    setCameraEvents() {
        // mouse click
        window.addEventListener('mousedown', (event) => {
            this.mousedown = true;
            this.mouse_pos = [event.clientX, event.clientY];
        });
        
        // mouse release
        window.addEventListener('mouseup', (event) => {
            this.mousedown = false;
        });

        // mouse move, if mouse is down, update orientation
        window.addEventListener('mousemove', (event) => {
            if (this.mousedown) {
                let dx = event.clientX - this.mouse_pos[0];
                let dy = event.clientY - this.mouse_pos[1];

                // update camera orientation
                this.updateCamera(dx, dy);

                // update new mouse position
                this.mouse_pos = [event.clientX, event.clientY];
            }
        });
    }

    /**
     * Updates the view matrix based on the current camera parameters.
     * @method module:webgl.CameraHandler#updateCamera
     * @param {number} dx - The change in mouse X position.
     * @param {number} dy - The change in mouse Y position.
     */ 
    updateCamera(dx, dy) {
        // compute relative right vector
        let right = glMatrix.vec3.fromValues(1, 0, 0);
        glMatrix.vec3.transformQuat(right, right, this.orientation);
        glMatrix.vec3.normalize(right, right);

        // compute relative up vector
        let up = glMatrix.vec3.fromValues(0, 1, 0);
        glMatrix.vec3.transformQuat(up, up, this.orientation);
        glMatrix.vec3.normalize(up, up);

        // yaw around world up, pitch around camera right
        // NOTE: negative angle because we want to rotate the world not the camera
        glMatrix.quat.setAxisAngle(this.yaw_quat, up, -dx * ROTATION_SPEED);
        glMatrix.quat.setAxisAngle(this.pitch_quat, right, -dy * ROTATION_SPEED);

        // compute new orientation = yaw * pitch * orientation
        glMatrix.quat.multiply(this.temp_quat, this.pitch_quat, this.orientation);
        glMatrix.quat.multiply(this.orientation, this.yaw_quat, this.temp_quat);
        glMatrix.quat.normalize(this.orientation, this.orientation);

        // apply new orientation to camera position
        let offset = glMatrix.vec3.fromValues(0, 0, this.distance);
        glMatrix.vec3.transformQuat(offset, offset, this.orientation);
        glMatrix.vec3.add(this.camera_pos, this.target, offset);
        
        // update view matrix
        glMatrix.mat4.lookAt(this.view_matrix, this.camera_pos, this.target, up);
    }
}