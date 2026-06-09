import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';
import { formatBytes } from './attachmentUtils';

export type { AttachmentState, AttachmentStateEntry } from './attachmentUtils';
import type { AttachmentStateEntry } from './attachmentUtils';

type AttachmentPreviewBarProps = {
    attachments: AttachmentStateEntry[];
    cliOfflineWarning?: string;
};

/**
 * Computes the grid layout parameters based on attachment count.
 * - 0: null (don't render)
 * - 1-3: single row, each card flex:1 (widthPercent based on count)
 * - 4-6: two rows, 3 columns, flexWrap
 * - >6: first 5 normal + overflow badge in 6th slot
 */
function computeLayout(count: number): {
    columns: number;
    visibleCount: number;
    overflowCount: number;
    itemWidthPercent: string;
} | null {
    if (count === 0) return null;

    if (count <= 3) {
        return {
            columns: count,
            visibleCount: count,
            overflowCount: 0,
            itemWidthPercent: `${(100 / count).toFixed(2)}%`,
        };
    }

    // count >= 4
    const columns = 3;
    if (count <= 6) {
        return {
            columns,
            visibleCount: count,
            overflowCount: 0,
            itemWidthPercent: '33.33%',
        };
    }

    // count > 6: show 5 normal + 1 overflow badge
    return {
        columns,
        visibleCount: 5,
        overflowCount: count - 5,
        itemWidthPercent: '33.33%',
    };
}

// ----------------------------------------------------------------
// OverflowBadge — internal component, not exported
// ----------------------------------------------------------------
const OverflowBadge = React.memo(({ count, widthPercent }: { count: number; widthPercent: string }) => {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.card, { width: widthPercent as any }]}>
            <View style={[styles.overflowBadge, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Text style={[styles.overflowText, { color: theme.colors.textSecondary }]}>
                    {t('fileShare.moreFiles', { count })}
                </Text>
            </View>
        </View>
    );
});

// ----------------------------------------------------------------
// AttachmentCard — internal component, not exported
// ----------------------------------------------------------------
type AttachmentCardProps = {
    entry: AttachmentStateEntry;
    widthPercent: string;
    cliOfflineWarning?: string;
};

const AttachmentCard = React.memo((props: AttachmentCardProps) => {
    const { entry, widthPercent, cliOfflineWarning } = props;
    const { theme } = useUnistyles();

    const isImage = entry.mimeType.startsWith('image/');

    const handleClose = React.useCallback(() => {
        hapticsLight();
        if (entry.status === 'ready') {
            entry.onRemove();
        } else {
            entry.onCancel();
        }
    }, [entry]);

    return (
        <View style={[styles.card, { width: widthPercent as any }]}>
            <View style={[styles.cardInner, { backgroundColor: theme.colors.surfaceHigh }]}>
                {/* File icon */}
                <View style={styles.iconContainer}>
                    <Ionicons
                        name={isImage ? 'image-outline' : 'document-outline'}
                        size={20}
                        color={theme.colors.button.secondary.tint}
                    />
                </View>

                {/* Info area */}
                <View style={styles.infoContainer}>
                    <Text style={styles.filename} numberOfLines={1}>
                        {entry.filename}
                    </Text>
                    <Text style={styles.filesize}>
                        {formatBytes(entry.sizeBytes)}
                    </Text>

                    {/* Error state */}
                    {entry.status === 'error' && (
                        <View style={styles.errorRow}>
                            <Text style={[styles.errorText, { color: theme.colors.textDestructive }]}>
                                {t('fileShare.uploadFailed')}
                            </Text>
                            <Pressable
                                onPress={() => {
                                    hapticsLight();
                                    entry.onRetry();
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
                    {entry.status === 'uploading' && (
                        <View style={styles.progressBarTrack}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    {
                                        width: `${entry.percent}%` as any,
                                        backgroundColor: theme.colors.button.primary.background,
                                    },
                                ]}
                            />
                        </View>
                    )}

                    {/* CLI offline warning — only shown on ready cards */}
                    {entry.status === 'ready' && cliOfflineWarning && (
                        <Text style={[styles.warningText, { color: theme.colors.textSecondary }]}>
                            {cliOfflineWarning}
                        </Text>
                    )}
                </View>

                {/* Close / cancel button */}
                <Pressable
                    onPress={handleClose}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
                >
                    <Ionicons
                        name="close"
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            </View>
        </View>
    );
});

// ----------------------------------------------------------------
// AttachmentPreviewBar — exported component
// ----------------------------------------------------------------
export const AttachmentPreviewBar = React.memo((props: AttachmentPreviewBarProps) => {
    const { attachments, cliOfflineWarning } = props;

    const layout = computeLayout(attachments.length);
    if (!layout) return null;

    const { visibleCount, overflowCount, itemWidthPercent } = layout;
    const visibleAttachments = attachments.slice(0, visibleCount);

    return (
        <View style={styles.gridContainer}>
            {visibleAttachments.map((entry) => (
                <AttachmentCard
                    key={entry.id}
                    entry={entry}
                    widthPercent={itemWidthPercent}
                    cliOfflineWarning={cliOfflineWarning}
                />
            ))}
            {overflowCount > 0 && (
                <OverflowBadge
                    count={overflowCount}
                    widthPercent={itemWidthPercent}
                />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    gridContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 4,
        paddingTop: 6,
        paddingBottom: 6,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },

    card: {
        paddingHorizontal: 4,
        paddingVertical: 4,
    },

    cardInner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        borderRadius: 8,
        padding: 6,
    },

    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },

    infoContainer: {
        flex: 1,
        gap: 2,
        overflow: 'hidden',
    },

    filename: {
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },

    filesize: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },

    progressBarTrack: {
        height: 3,
        backgroundColor: theme.colors.divider,
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 2,
    },

    progressBarFill: {
        height: 3,
        borderRadius: 2,
    },

    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
    },

    errorText: {
        fontSize: 10,
        ...Typography.default(),
    },

    retryButton: {
        paddingHorizontal: 4,
        paddingVertical: 1,
    },

    retryButtonPressed: {
        opacity: 0.6,
    },

    retryText: {
        fontSize: 10,
        ...Typography.default('semiBold'),
    },

    warningText: {
        fontSize: 10,
        marginTop: 2,
        ...Typography.default(),
    },

    closeButton: {
        padding: 2,
        flexShrink: 0,
    },

    closeButtonPressed: {
        opacity: 0.6,
    },

    overflowBadge: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        minHeight: 48,
        padding: 6,
    },

    overflowText: {
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
}));
