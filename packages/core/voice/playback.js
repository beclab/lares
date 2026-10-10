/**
 * The phone plays the same answer the headset plays.
 * The desktop page shares the room with that headset, and its browser does not open the call link.
 */
export function browserPlays(surface, bluetooth) {
  return !(surface === "pc" && bluetooth === "played");
}
