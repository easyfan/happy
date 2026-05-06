import * as React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { DiffView } from '@/components/diff/DiffView';
import { Typography } from '@/constants/Typography';

export interface PierreDiffViewProps {
    oldFile?: { name: string; contents: string };
    newFile?: { name: string; contents: string };
    /** Unified diff string — alternative to oldFile/newFile. */
    patch?: string;
    diffStyle?: 'unified' | 'split';
    overflow?: 'scroll' | 'wrap';
    disableLineNumbers?: boolean;
    /** Hide Pierre's built-in file-name/stats header — useful when the surrounding UI already shows one. Web-only. */
    disableFileHeader?: boolean;
    /** Forces a theme override; defaults to the current app theme. */
    theme?: 'dark' | 'light';
    /** Replace Pierre's default header with custom React content. Web-only. */
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
}

/** Fire-and-forget prefetch — no-op on native. */
export function prefetchPierreDiff(): void {
    // no-op on native; web implementation is in PierreDiffView.web.tsx
}

// ────────────────────────────────────────────────────────────────────────────
// Native: no network dependencies. For oldFile/newFile we route to the classic
// plain-text DiffView; for a raw patch string we colorize lines by prefix.
// Always unified on native — `diffStyle` is intentionally ignored.
// ────────────────────────────────────────────────────────────────────────────

export const PierreDiffView = React.memo(function PierreDiffView(props: PierreDiffViewProps) {
    if (props.patch) {
        return <PlainPatchView patch={props.patch} wrapLines={props.overflow === 'wrap'} />;
    }
    if (props.oldFile && props.newFile) {
        return (
            <DiffView
                oldText={props.oldFile.contents}
                newText={props.newFile.contents}
                showLineNumbers={!props.disableLineNumbers}
                wrapLines={props.overflow === 'wrap'}
            />
        );
    }
    return <View />;
});

function PlainPatchView({ patch, wrapLines }: { patch: string; wrapLines: boolean }) {
    const { theme } = useUnistyles();
    const colors = theme.colors.diff;

    const lines = React.useMemo(() => patch.split('\n'), [patch]);

    return (
        <View style={{ backgroundColor: theme.colors.surface, flex: 1, overflow: 'hidden' }}>
            {lines.map((line, i) => {
                const first = line.charAt(0);
                const isFileHeader =
                    line.startsWith('+++') ||
                    line.startsWith('---') ||
                    line.startsWith('diff ') ||
                    line.startsWith('index ') ||
                    line.startsWith('new file') ||
                    line.startsWith('deleted file') ||
                    line.startsWith('rename ') ||
                    line.startsWith('similarity ') ||
                    line.startsWith('Binary files');
                const isHunkHeader = line.startsWith('@@');

                let bg: string = colors.contextBg;
                let fg: string = colors.contextText;

                if (isHunkHeader) {
                    bg = colors.hunkHeaderBg;
                    fg = colors.hunkHeaderText;
                } else if (isFileHeader) {
                    bg = colors.contextBg;
                    fg = colors.hunkHeaderText;
                } else if (first === '+') {
                    bg = colors.addedBg;
                    fg = colors.addedText;
                } else if (first === '-') {
                    bg = colors.removedBg;
                    fg = colors.removedText;
                }

                return (
                    <Text
                        key={i}
                        numberOfLines={wrapLines ? undefined : 1}
                        style={{
                            ...Typography.mono(),
                            fontSize: 13,
                            lineHeight: 20,
                            backgroundColor: bg,
                            color: fg,
                            paddingHorizontal: 8,
                        }}
                    >
                        {line.length === 0 ? ' ' : line}
                    </Text>
                );
            })}
        </View>
    );
}
