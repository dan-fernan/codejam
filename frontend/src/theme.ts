// Single source of truth for CodeJam's visual language, derived from the
// CodejamJarFlat mascot. Nothing else in the app should hardcode these hex
// values or animation timings - import them from here so the mascot and the
// rest of the UI never drift apart.

export const C = {
  jam: '#ff4b57',
  jamDeep: '#e93348',
  glass: '#e9f2f4',
  glassNeck: '#dfe9ec',
  lid: '#3c3a44',
  lidMid: '#514e5c',
  lidTop: '#6a6678',
  seed: '#ffe6c4',
  white: '#ffffff',
  pupil: '#1c1a22',
  paper: '#fff3dc',
  ink: '#2b2630',
  mouth: '#8e1226',
  tongue: '#ff8fa0',
} as const

export const KEYFRAMES = `
@keyframes cjf-hop { 0%,100% { transform: translateY(0) scale(1,1); } 12% { transform: translateY(2px) scale(1.05,.95); } 34% { transform: translateY(-14px) scale(.95,1.06); } 60% { transform: translateY(0) scale(1.04,.96); } 74% { transform: translateY(0) scale(1,1); } }
@keyframes cjf-idle { 0%,100% { transform: translateY(0) scale(1,1); } 50% { transform: translateY(-6px) scale(.985,1.015); } }
@keyframes cjf-blink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.06); } 97.5% { transform: scaleY(1); } }
@keyframes cjf-slosh { 0%,100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
@keyframes cjf-tilt { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(7deg); } 60% { transform: rotate(-6deg); } 85% { transform: rotate(2deg); } }
`

// A small set of "jam flavors" at the same flat saturation/lightness family
// as the mascot's own jam red, used to color multiplayer cursors/selections.
// Picked from a client's Yjs clientID so a collaborator's color is stable
// for the life of their session without needing a server-assigned identity.
export const FLAVORS = [C.jam, '#4b7bff', '#9b5de5', '#6fcf5b', '#ff9f43'] as const

export function flavorForClientId(clientId: number): string {
  return FLAVORS[Math.abs(clientId) % FLAVORS.length]
}

export const FONT_UI = "'Nunito', ui-rounded, system-ui, sans-serif"
export const FONT_MONO = "'JetBrains Mono', monospace"
