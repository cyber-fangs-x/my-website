"use strict";

class GeometryHandler {
    /**
	 * This class handles the geometry data structure for rendering and processing.
	 * @constructor module:webgl.GeometryHandler
     * @param {string} obj_file - The OBJ file content as a string.
	 * @property {[]} vertices - The vertex positions, used for rendering.
	 * @property {[]} faces - The face indices array, used for rendering.
	 * @property {[]} normals - The vertex normals, used for rendering.
     * @property {[]} colors - The vertex colors, used for rendering.
	 * @property {module:lib/geometry-processing-js/Core.Mesh} mesh - The mesh data structure from geometry-processing-js.
     * @property {module:lib/geometry-processing-js/Core.Geometry} geometry - The geometry data structure from geometry-processing-js.
	 */
    constructor(obj_file) {
        this.vertices = [];
        this.faces = [];
        this.normals = [];
        this.colors = [];
        this.mesh = null;
        this.geometry = null;

        this.setGeometry(obj_file);
    }  
    
    /**
	 * Sets up geometric data structures and extracts vertex/face attributes.
	 * @method module:webgl.GeometryHandler#setGeometry
     * @param {string} obj_file - The OBJ file content as a string.
	 */
    setGeometry(obj_file) {
        // Parse the OBJ file and create a mesh
        let polygonSoup = MeshIO.readOBJ(obj_file);
        let mesh = new Mesh();
        let success = mesh.build(polygonSoup);
        if (!success) {
            throw new Error("Failed to build mesh from OBJ data.");
        }
        
        // create geometry object, normalized
        let geometry = new Geometry(mesh, polygonSoup["v"]);

        // fill position, normal and color buffers
        let V = mesh.vertices.length;
        let positions = new Float32Array(V * 3);
        let normals = new Float32Array(V * 3);
        let colors = new Float32Array(V * 3);
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
        let indices = new Uint32Array(F * 3);
        for (let f of mesh.faces) {
            let i = 0;
            for (let v of f.adjacentVertices()) {
            indices[3 * f.index + i++] = v.index;
            }
        }

        // assign to class properties
        this.vertices = positions;
        this.faces = indices;
        this.normals = normals;
        this.mesh = mesh;
        this.geometry = geometry
        this.colors = colors;
    }
}