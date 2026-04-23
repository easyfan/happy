import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { encodeBase64 } from '@/encryption/base64';
import { downloadUpload } from '@/sync/apiUploads';
import { decryptFileFromDownload } from '@/sync/fileEncryption';
import { useSessionEncryption } from '@/sync/SessionEncryptionContext';
import { FileShareMessage } from '@/sync/typesMessage';
import { t } from '@/text';

type DownloadState =
    | { status: 'pending' }
    | { status: 'downloading' }
    | { status: 'ready'; localUri: string }
    | { status: 'error'; error: string };

type FileShareBubbleProps = {
    message: FileShareMessage;
    sessionId: string;
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileShareBubble = React.memo((props: FileShareBubbleProps) => {
    const { message, sessionId } = props;
    const sessionKey = useSessionEncryption();
    const { theme } = useUnistyles();

    const [downloadState, setDownloadState] = React.useState<DownloadState>({ status: 'pending' });

    const isImage = message.mimeType.startsWith('image/');

    const doDownload = React.useCallback(async () => {
        if (!sessionKey) {
            setDownloadState({ status: 'error', error: 'No session key available' });
            return;
        }
        setDownloadState({ status: 'downloading' });
        try {
            const raw = await downloadUpload(message.uploadId, sessionId);
            const decrypted = decryptFileFromDownload(raw.encryptedBlob, raw.nonce, sessionKey);
            if (!decrypted) {
                setDownloadState({ status: 'error', error: 'Decryption failed' });
                return;
            }
            // Save to a temp file
            const ext = message.filename.includes('.')
                ? message.filename.split('.').pop()!
                : 'bin';
            const localUri = `${FileSystem.cacheDirectory}${message.uploadId}.${ext}`;
            const base64Data = encodeBase64(decrypted);
            await FileSystem.writeAsStringAsync(localUri, base64Data, {
                encoding: FileSystem.EncodingType.Base64,
            });
            setDownloadState({ status: 'ready', localUri });
        } catch (e: any) {
            setDownloadState({ status: 'error', error: e?.message ?? 'Download failed' });
        }
    }, [message.uploadId, message.filename, sessionId, sessionKey]);

    // Auto-trigger download on mount
    React.useEffect(() => {
        doDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message.uploadId]);

    const handleOpenFile = React.useCallback(async () => {
        if (downloadState.status !== 'ready') return;
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
            await Sharing.shareAsync(downloadState.localUri, {
                mimeType: message.mimeType,
                dialogTitle: message.filename,
            });
        }
    }, [downloadState, message.mimeType, message.filename]);

    if (isImage) {
        return (
            <View style={styles.agentMessageContainer}>
                {downloadState.status === 'ready' ? (
                    <Pressable onLongPress={handleOpenFile}>
                        <Image
                            source={{ uri: downloadState.localUri }}
                            style={{ width: 240, height: 180, borderRadius: 8 }}
                            contentFit="cover"
                        />
                    </Pressable>
                ) : downloadState.status === 'error' ? (
                    <View style={styles.errorContainer}>
                        <Text style={[styles.errorText, { color: theme.colors.textDestructive }]}>
                            {t('fileShare.downloadFailed')}
                        </Text>
                        <Pressable
                            onPress={doDownload}
                            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                        >
                            <Text style={[styles.retryText, { color: theme.colors.button.primary.background }]}>
                                {t('fileShare.retry')}
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    <View style={styles.shimmerImage} />
                )}
                <Text style={styles.caption}>
                    {message.filename} · {formatBytes(message.sizeBytes)}
                </Text>
            </View>
        );
    }

    // Non-image (PDF, TXT, etc.)
    return (
        <View style={styles.agentMessageContainer}>
            <View style={[styles.fileCard, { borderColor: theme.colors.divider }]}>
                <View style={styles.fileCardHeader}>
                    <View style={styles.fileIconContainer}>
                        <Ionicons
                            name={message.mimeType === 'application/pdf' ? 'document-text-outline' : 'document-outline'}
                            size={24}
                            color={theme.colors.button.secondary.tint}
                        />
                    </View>
                    <View style={styles.fileInfo}>
                        <Text style={styles.filename} numberOfLines={2}>
                            {message.filename}
                        </Text>
                        <Text style={styles.filesize}>
                            {formatBytes(message.sizeBytes)}
                        </Text>
                        {message.description && (
                            <Text style={styles.description} numberOfLines={2}>
                                {message.description}
                            </Text>
                        )}
                    </View>
                </View>

                {downloadState.status === 'downloading' && (
                    <View style={styles.shimmerBar} />
                )}

                {downloadState.status === 'error' && (
                    <View style={styles.errorRow}>
                        <Text style={[styles.errorText, { color: theme.colors.textDestructive }]}>
                            {t('fileShare.downloadFailed')}
                        </Text>
                        <Pressable
                            onPress={doDownload}
                            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                        >
                            <Text style={[styles.retryText, { color: theme.colors.button.primary.background }]}>
                                {t('fileShare.retry')}
                            </Text>
                        </Pressable>
                    </View>
                )}

                {downloadState.status === 'ready' && (
                    <Pressable
                        onPress={handleOpenFile}
                        style={({ pressed }) => [
                            styles.openButton,
                            { backgroundColor: theme.colors.button.primary.background },
                            pressed && styles.openButtonPressed,
                        ]}
                    >
                        <Text style={[styles.openButtonText, { color: theme.colors.button.primary.tint }]}>
                            {t('fileShare.openFile')}
                        </Text>
                    </Pressable>
                )}

                {downloadState.status === 'pending' && (
                    <Text style={styles.preparingText}>
                        {t('fileShare.preparingFile')}
                    </Text>
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    agentMessageContainer: {
        marginHorizontal: 16,
        marginBottom: 12,
        alignSelf: 'flex-start',
    },
    shimmerImage: {
        width: 240,
        height: 180,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
    },
    caption: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 4,
        ...Typography.default(),
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 8,
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    errorText: {
        fontSize: 12,
        ...Typography.default(),
    },
    retryButton: {
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    retryButtonPressed: {
        opacity: 0.6,
    },
    retryText: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    fileCard: {
        backgroundColor: theme.colors.surface,
        borderWidth: 0.5,
        borderRadius: 12,
        padding: 12,
        width: 280,
    },
    fileCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    fileIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    fileInfo: {
        flex: 1,
    },
    filename: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    filesize: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    description: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
        ...Typography.default(),
    },
    shimmerBar: {
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.surfaceHigh,
        marginTop: 10,
    },
    openButton: {
        marginTop: 10,
        borderRadius: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    openButtonPressed: {
        opacity: 0.7,
    },
    openButtonText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    preparingText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 8,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
