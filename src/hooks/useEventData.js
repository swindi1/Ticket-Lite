import { useContext } from 'react';
import { EventContext } from '../context/EventContext';

export function useEventData() {
    return useContext(EventContext);
}
