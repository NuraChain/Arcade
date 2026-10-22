import { useConnection } from '../../stores/connection.store.ts';
import { sayAtTable } from './notice.ts';
import Strips from './strips.component.azeroth';

export const draw = () => Strips({});

export const begin = () =>
{
    const stopConnection = useConnection().start();
    const stopNotice = sayAtTable();

    return () =>
    {
        stopNotice();
        stopConnection();
    };
};
