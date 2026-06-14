import { MMKV } from 'react-native-mmkv'

const initStorage = () => {
    const storage = new MMKV();
    console.log(`storage initialized`);
    return storage;
}

export const localStorage = initStorage();