import type { TestSuite } from "./types";
import starterPluginTestSuite from "./starter-plugin";

// Note: Additional test suites can be added here as they are implemented:
// - hyperscapeIntegrationTestSuite: Full integration with live Hyperscape server
// - multiAgentTestSuite: Multi-agent coordination testing
// - voiceTestSuite: Voice/LiveKit bidirectional testing

export const testSuites: TestSuite[] = [starterPluginTestSuite];

export default testSuites;
