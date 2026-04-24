import * as React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';

interface QRScannerScreenProps {
    urlPrefix: string;
    onScanned: (url: string) => void;
    onClose: () => void;
}

export function QRScannerScreen({ urlPrefix, onScanned, onClose }: QRScannerScreenProps) {
    const device = useCameraDevice('back');
    const scannedRef = React.useRef(false);

    // Reset scanned lock when component mounts (handles reuse after close/reopen)
    React.useEffect(() => {
        scannedRef.current = false;
    }, []);

    const codeScanner = useCodeScanner({
        codeTypes: ['qr'],
        onCodeScanned: (codes) => {
            if (scannedRef.current) return;
            const url = codes.find(c => c.value?.startsWith(urlPrefix))?.value;
            if (url) {
                scannedRef.current = true;
                onScanned(url);
            }
        },
    });

    if (!device) {
        return (
            <View style={styles.overlay}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Camera not available</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Text style={styles.closeButtonText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.overlay}>
            <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={true}
                codeScanner={codeScanner}
            />
            <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
                <Ionicons name="close-circle" size={40} color="white" />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
        backgroundColor: 'black',
    },
    closeIcon: {
        position: 'absolute',
        top: 56,
        right: 20,
    },
    errorContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },
    errorText: {
        color: 'white',
        fontSize: 16,
    },
    closeButton: {
        paddingHorizontal: 24,
        paddingVertical: 10,
        backgroundColor: '#ffffff33',
        borderRadius: 8,
    },
    closeButtonText: {
        color: 'white',
        fontSize: 16,
    },
});
