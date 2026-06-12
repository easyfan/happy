import { installIntegrationEnvironment } from './installIntegrationEnvironment';

// CLI daemon and openclaw integration tests only need happy-server, not the
// Expo Metro bundle server. skipWeb avoids a 60-120 s Metro cold-start timeout.
await installIntegrationEnvironment({
    template: 'authenticated-empty',
    up: true,
    skipWeb: true,
});
