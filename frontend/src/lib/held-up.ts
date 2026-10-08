import { createSignal } from 'azerothjs';

const [heldUp, setHeldUp] = createSignal(false);

export { heldUp, setHeldUp };
