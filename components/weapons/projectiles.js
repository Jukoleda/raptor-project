// Basic projectile (shell) types and the damage scheme that turns a ballistics
// result into hit points.
//
// Every type bends the shared penetration model (see ballistics.js) and decides
// how a hit becomes damage. The fields:
//
//   id / name         identifier and readable Spanish label
//   penMultiplier     scales the gun's nominal penetration (mm)
//   damageMultiplier  scales the gun's nominal damage on a clean penetration
//   ricochetAngle     impact angle from the surface normal beyond which the
//                     shell skips off (90 = never ricochets)
//   normalizes        true  -> sloped armor counts more (effective = nominal/cosθ)
//                     false -> the shell defeats the nominal thickness regardless
//                              of slope (shaped charge / surface burst)
//   splash            fraction of damage that still leaks through on a non-pen,
//                     i.e. fragments spraying past un-breached plate (HE)
//
// The four staples of arcade tank games:
//   AP    Perforante     — the all-rounder: solid shot, slope matters, skips off
//                          steep plates.
//   APCR  Subcalibre     — more penetration, less damage, ricochets sooner.
//   HEAT  Carga hueca    — shaped charge: ignores slope, never ricochets, steady
//                          damage; the answer to angled armor.
//   HE    Alto explosivo — little penetration but a big punch, and even a non-pen
//                          chips the target with fragments.

import { evaluateImpact } from "./ballistics.js";

export const PROJECTILES = {
    AP:   { id: "AP",   name: "Perforante",     penMultiplier: 1.0,  damageMultiplier: 1.0, ricochetAngle: 70, normalizes: true,  splash: 0 },
    APCR: { id: "APCR", name: "Subcalibre",     penMultiplier: 1.4,  damageMultiplier: 0.7, ricochetAngle: 68, normalizes: true,  splash: 0 },
    HEAT: { id: "HEAT", name: "Carga hueca",    penMultiplier: 1.2,  damageMultiplier: 1.1, ricochetAngle: 90, normalizes: false, splash: 0 },
    HE:   { id: "HE",   name: "Alto explosivo", penMultiplier: 0.35, damageMultiplier: 1.8, ricochetAngle: 90, normalizes: false, splash: 0.25 },
};

// Default type when a weapon / bullet does not name one.
export const DEFAULT_PROJECTILE = PROJECTILES.AP;

// Resolves a shot end to end: runs the penetration model tuned for the shell
// `type`, then applies its damage scheme. Returns the ballistics result extended
// with `damage` (hit points actually dealt to the plate):
//   penetration -> full damage
//   block       -> splash * damage (HE fragments; 0 for solid shot)
//   ricochet    -> no damage
export function resolveShot({ type = DEFAULT_PROJECTILE, penetration, damage, direction, normal, armor }) {
    const impact = evaluateImpact({
        direction,
        normal,
        penetration,
        armor,
        ricochetAngle: type.ricochetAngle,
        normalizes: type.normalizes,
    });

    let dealt = 0;
    if (impact.result === "penetration") {
        dealt = damage;
    } else if (impact.result === "block") {
        dealt = Math.round(damage * type.splash);
    }

    return { ...impact, type, damage: dealt };
}
