// Minimal react-native shim for running unit tests in jsdom/Node.js.
// Only exports the primitives actually used by the components under test.
// This shim is referenced via vitest.config.ts resolve.alias.
import React from 'react';

const View = ({ children, style, ...rest }: any) =>
    React.createElement('View', { style, ...rest }, children);

const Text = ({ children, style, ...rest }: any) =>
    React.createElement('Text', { style, ...rest }, children);

const TouchableOpacity = ({ children, style, onPress, disabled, activeOpacity, ...rest }: any) =>
    React.createElement('TouchableOpacity', { style, onPress, disabled, activeOpacity, ...rest }, children);

const ActivityIndicator = ({ size, color, ...rest }: any) =>
    React.createElement('ActivityIndicator', { size, color, ...rest });

const StyleSheet = {
    create: (s: any) => s,
    hairlineWidth: 1,
    absoluteFill: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
};

const Platform = { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default };

export {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    Platform,
};
