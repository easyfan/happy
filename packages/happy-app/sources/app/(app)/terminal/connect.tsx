import React, { useState } from 'react';
import { View, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { useRouter } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Ionicons } from '@expo/vector-icons';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { t } from '@/text';

// Capture hash immediately at module load time, before Expo Router can strip it
const _capturedKey = Platform.OS === 'web' && typeof window !== 'undefined'
    ? (() => {
        const hash = window.location.hash;
        if (hash.startsWith('#key=')) {
            // Stash in sessionStorage so it survives SPA re-render
            sessionStorage.setItem('__happyConnectKey', hash.substring(5));
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return null;
    })()
    : null;

export default function TerminalConnectScreen() {
    const router = useRouter();
    const [publicKey] = useState<string | null>(() => {
        if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
            const key = sessionStorage.getItem('__happyConnectKey');
            if (key) {
                sessionStorage.removeItem('__happyConnectKey');
                return key;
            }
        }
        return null;
    });
    const { processAuthUrl, isLoading } = useConnectTerminal({
        onSuccess: () => {
            router.back();
        }
    });

    const handleConnect = async () => {
        if (publicKey) {
            // Convert the hash key format to the expected happy:// URL format
            const authUrl = `happy://terminal?${publicKey}`;
            await processAuthUrl(authUrl);
        }
    };

    const handleReject = () => {
        router.back();
    };

    // Show placeholder for mobile platforms
    if (Platform.OS !== 'web') {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ 
                        alignItems: 'center',
                        paddingVertical: 32,
                        paddingHorizontal: 16
                    }}>
                        <Ionicons 
                            name="laptop-outline" 
                            size={64} 
                            color="#8E8E93" 
                            style={{ marginBottom: 16 }} 
                        />
                        <Text style={{ 
                            ...Typography.default('semiBold'), 
                            fontSize: 18, 
                            textAlign: 'center',
                            marginBottom: 12 
                        }}>
                            {t('terminal.webBrowserRequired')}
                        </Text>
                        <Text style={{ 
                            ...Typography.default(), 
                            fontSize: 14, 
                            color: '#666', 
                            textAlign: 'center',
                            lineHeight: 20 
                        }}>
                            {t('terminal.webBrowserRequiredDescription')}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Show error if no key found
    if (!publicKey) {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ 
                        alignItems: 'center',
                        paddingVertical: 32,
                        paddingHorizontal: 16
                    }}>
                        <Ionicons 
                            name="warning-outline" 
                            size={48} 
                            color="#FF3B30" 
                            style={{ marginBottom: 16 }} 
                        />
                        <Text style={{ 
                            ...Typography.default('semiBold'), 
                            fontSize: 16, 
                            color: '#FF3B30',
                            textAlign: 'center',
                            marginBottom: 8 
                        }}>
                            {t('terminal.invalidConnectionLink')}
                        </Text>
                        <Text style={{ 
                            ...Typography.default(), 
                            fontSize: 14, 
                            color: '#666', 
                            textAlign: 'center',
                            lineHeight: 20 
                        }}>
                            {t('terminal.invalidConnectionLinkDescription')}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Show confirmation screen for valid connection
    return (
        <ItemList>
            {/* Connection Request Header */}
            <ItemGroup>
                <View style={{ 
                    alignItems: 'center',
                    paddingVertical: 24,
                    paddingHorizontal: 16
                }}>
                    <Ionicons 
                        name="terminal-outline" 
                        size={48} 
                        color="#007AFF" 
                        style={{ marginBottom: 16 }} 
                    />
                    <Text style={{ 
                        ...Typography.default('semiBold'), 
                        fontSize: 20, 
                        textAlign: 'center',
                        marginBottom: 12
                    }}>
                        {t('terminal.connectTerminal')}
                    </Text>
                    <Text style={{ 
                        ...Typography.default(), 
                        fontSize: 14, 
                        color: '#666', 
                        textAlign: 'center',
                        lineHeight: 20 
                    }}>
                        {t('terminal.terminalRequestDescription')}
                    </Text>
                </View>
            </ItemGroup>

            {/* Connection Details */}
            <ItemGroup title={t('terminal.connectionDetails')}>
                <Item
                    title={t('terminal.publicKey')}
                    detail={`${publicKey.substring(0, 12)}...`}
                    icon={<Ionicons name="key-outline" size={29} color="#007AFF" />}
                    showChevron={false}
                />
                <Item
                    title={t('terminal.encryption')}
                    detail={t('terminal.endToEndEncrypted')}
                    icon={<Ionicons name="lock-closed-outline" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Action Buttons */}
            <ItemGroup>
                <View style={{ 
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    gap: 12 
                }}>
                    <RoundButton
                        title={isLoading ? t('terminal.connecting') : t('terminal.acceptConnection')}
                        onPress={handleConnect}
                        size="large"
                        disabled={isLoading}
                        loading={isLoading}
                    />
                    <RoundButton
                        title={t('terminal.reject')}
                        onPress={handleReject}
                        size="large"
                        display="inverted"
                        disabled={isLoading}
                    />
                </View>
            </ItemGroup>

            {/* Security Notice */}
            <ItemGroup 
                title={t('terminal.security')}
                footer={t('terminal.securityFooter')}
            >
                <Item
                    title={t('terminal.clientSideProcessing')}
                    subtitle={t('terminal.linkProcessedLocally')}
                    icon={<Ionicons name="shield-checkmark-outline" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}