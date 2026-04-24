import { Camera } from "react-native-vision-camera";

export function useCheckScannerPermissions(): () => Promise<boolean> {
    return async () => {
        const status = await Camera.requestCameraPermission();
        return status === 'granted';
    };
}