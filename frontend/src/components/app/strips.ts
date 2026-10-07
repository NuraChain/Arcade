import { useConnection } from '../../stores/connection.store.ts';
import Strips from './strips.component.azeroth';

export const draw = () => Strips({});

export const begin = () => useConnection().start();
