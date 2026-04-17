import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';

export type AttachmentState =
    | { status: 'uploading'; filename: string; mimeType: string; sizeBytes: number; percent: number; onCancel: () => void }
    | { status: 'ready'; filename: string; mimeType: string; sizeBytes: number; onRemove: () => void }
    | { status: 'error'; filename: string; mimeType: string; sizeBytes: number; onRetry: () => void; onCancel: () => void };

type AttachmentPreviewBarProps = {
    attachment: AttachmentState;
    cliOfflineWarning?: string;
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AttachmentPreviewBar = React.memo((props: AttachmentPreviewBarProps) => {
    const { attachment, cliOfflineWarning } = props;
    const { theme } = useUnistyles();

    const isImage = attachment.mimeType.startsWith('image/');

    const handleCancelOrRemove = React.useCallback(() => {
        hapticsLight();
        if (attachment.status === 'ready') {
            attachment.onRemove();
        } else {
            attachment.onCancel();
        }
    }, [attachment]);

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                {/* File icon */}
                <View style={styles.docIconContainer}>
                    <Ionicons
                        name={isImage ? 'image-outline' : 'document-outline'}
                        size={22}
                        color={theme.colors.button.secondary.tint}
                    />
                </View>

                {/* File info */}
                <View style={styles.infoContainer}>
                    <Text style={styles.filename} numberOfLines={1}>
                        {attachment.filename}
                    </Text>
                    <Text style={styles.filesize}>
                        {formatBytes(attachment.sizeBytes)}
                    </Text>

                    {/* Error state */}
                    {attachment.status === 'error' && (
                        <View style={styles.errorRow}>
                            <Text style={[styles.errorText, { color: theme.colors.textDestructive }]}>
                                {t('fileShare.uploadFailed')}
                            </Text>
                            <Pressable
                                onPress={() => {
                                    hapticsLight();
                                    attachment.onRetry();
                                }}
                                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                            >
                                <Text style={[styles.retryText, { color: theme.colors.button.primary.background }]}>
                                    {t('fileShare.retry')}
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Uploading progress bar */}
                    {attachment.status === 'uploading' && (
                        <View style={styles.progressBarTrack}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    {
                                        width: `${attachment.percent}%` as any,
                                        backgroundColor: theme.colors.button.primary.background,
                                    },
                                ]}
                            />
                        </View>
                    )}

                    {/* CLI offline warning */}
                    {cliOfflineWarning && (
                        <Text style={[styles.warningText, { color: theme.colors.textSecondary }]}>
                            {cliOfflineWarning}
                        </Text>
                    )}
                </View>

                {/* Close / cancel button */}
                <Pressable
                    onPress={handleCancelOrRemove}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
                >
                    <Ionicons
                        name="close"
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 8,
        marginHorizontal: 8,
        marginBottom: 4,
        borderWidth: 0.5,
        borderColor: theme.colors.divider,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    docIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
    },
    infoContainer: {
        flex: 1,
        gap: 2,
    },
    filename: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    filesize: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    errorText: {
        fontSize: 11,
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
        fontSize: 11,
        ...Typography.default('semiBold'),
    },
    progressBarTrack: {
        height: 4,
        backgroundColor: theme.colors.divider,
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 2,
    },
    progressBarFill: {
        height: 4,
        borderRadius: 2,
    },
    warningText: {
        fontSize: 11,
        marginTop: 2,
        ...Typography.default(),
    },
    closeButton: {
        padding: 4,
    },
    closeButtonPressed: {
        opacity: 0.6,
    },
}));
