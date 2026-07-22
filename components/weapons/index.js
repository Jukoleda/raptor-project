// Barrel for the weapons / ballistics layer.
export { default as Weapon } from "./weapon.js";
export { default as Bullet } from "./bullet.js";
export { default as Armor } from "./armor.js";
export { raycastShape, evaluateImpact, reflect } from "./ballistics.js";
export { PROJECTILES, DEFAULT_PROJECTILE, resolveShot } from "./projectiles.js";
