// Barrel for the 3D layer.
export { default as Mesh, DEFAULT_LIGHT } from "./mesh.js";
export { default as Camera3D } from "./camera3d.js";
export { getProgram3D, PROGRAM_LIT, PROGRAM_FLAT, PROGRAM_TEXTURED } from "./shaders3d.js";
export {
    boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry,
    planeGeometry, torusGeometry, prismGeometry,
} from "./geometry.js";
