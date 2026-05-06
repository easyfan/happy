import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { PierreDiffViewProps } from './PierreDiffView';

export type { PierreDiffViewProps };

// ────────────────────────────────────────────────────────────────────────────
// Web module loader. Both @pierre/diffs and @pierre/diffs/react are lazy
// chunks; we resolve them once per app run and memoize the promise so every
// diff mount after the first one gets a cache hit with no extra render cycle.
// ────────────────────────────────────────────────────────────────────────────

// @pierre/diffs is not installed as a package dep (loaded via CDN at runtime).
// Types are intentionally loose here to avoid needing the package at build time.
type PierreMain = any;
type PierreReact = any;
type PierreBundle = { main: PierreMain; react: PierreReact };

let pierreBundlePromise: Promise<PierreBundle> | null = null;

function loadPierre(): Promise<PierreBundle> {
    if (!pierreBundlePromise) {
        pierreBundlePromise = (async () => {
            // Side-effect import registers the <diffs-container> custom element.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — @pierre/diffs loaded at runtime, not installed as package dep
            const main = await import('@pierre/diffs');
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const react = await import('@pierre/diffs/react');
            return { main, react };
        })();
    }
    return pierreBundlePromise;
}

/**
 * Fire-and-forget prefetch — call once when entering a screen that will show
 * diffs so the lazy chunks are already in cache by the time they're rendered.
 */
export function prefetchPierreDiff(): void {
    void loadPierre();
}

function usePierreBundle(): PierreBundle | null {
    const [bundle, setBundle] = React.useState<PierreBundle | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        loadPierre().then((b) => { if (!cancelled) setBundle(b); });
        return () => { cancelled = true; };
    }, []);
    return bundle;
}

// ────────────────────────────────────────────────────────────────────────────
// Web rendering.
// ────────────────────────────────────────────────────────────────────────────

export const PierreDiffView = React.memo(function PierreDiffView(props: PierreDiffViewProps) {
    const { theme } = useUnistyles();
    const themeName: 'dark' | 'light' = props.theme ?? (theme.dark ? 'dark' : 'light');
    const diffsTheme = themeName === 'dark' ? 'github-dark-default' : 'github-light-default';
    const bundle = usePierreBundle();

    if (!bundle) return <DiffSkeleton />;

    const options = {
        theme: diffsTheme as any,
        diffStyle: props.diffStyle,
        overflow: props.overflow,
        disableLineNumbers: props.disableLineNumbers,
        disableFileHeader: props.disableFileHeader,
    };

    if (props.patch) {
        return <PatchFilesWeb bundle={bundle} patch={props.patch} options={options} renderCustomHeader={props.renderCustomHeader} />;
    }

    if (props.oldFile && props.newFile) {
        return <FileDiffFromFiles bundle={bundle} oldFile={props.oldFile} newFile={props.newFile} options={options} renderCustomHeader={props.renderCustomHeader} />;
    }

    return <View />;
});

function PatchFilesWeb({
    bundle,
    patch,
    options,
    renderCustomHeader,
}: {
    bundle: PierreBundle;
    patch: string;
    options: any;
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
}) {
    const files = React.useMemo(() => {
        try {
            const parsed = bundle.main.processPatch(patch);
            return parsed.files ?? [];
        } catch {
            return [];
        }
    }, [bundle, patch]);

    const { FileDiff } = bundle.react;
    return (
        <View>
            {(files as any[]).map((fileDiff: any, i: number) => (
                <FileDiff key={i} fileDiff={fileDiff} options={options} renderCustomHeader={renderCustomHeader} />
            ))}
        </View>
    );
}

function FileDiffFromFiles({
    bundle,
    oldFile,
    newFile,
    options,
    renderCustomHeader,
}: {
    bundle: PierreBundle;
    oldFile: { name: string; contents: string };
    newFile: { name: string; contents: string };
    options: any;
    renderCustomHeader?: (fileDiff: any) => React.ReactNode;
}) {
    const fileDiff = React.useMemo(
        () => bundle.main.parseDiffFromFile(oldFile, newFile),
        [bundle, oldFile, newFile],
    );
    const { FileDiff } = bundle.react;
    return <FileDiff fileDiff={fileDiff} options={options} renderCustomHeader={renderCustomHeader} />;
}

function DiffSkeleton() {
    const { theme } = useUnistyles();
    return (
        <View
            style={{
                height: 96,
                backgroundColor: theme.colors.surface,
                borderRadius: 6,
                opacity: 0.5,
            }}
        />
    );
}
