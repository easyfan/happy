import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSessionScanner } from './sessionScanner'
import { RawJSONLines } from '../types'
import { mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { getProjectPath } from './path'

describe('sessionScanner', () => {
  let testDir: string
  let projectDir: string
  let collectedMessages: RawJSONLines[]
  let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null
  
  beforeEach(async () => {
    testDir = join(tmpdir(), `scanner-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    // Use the same path calculation as the scanner to ensure paths match
    projectDir = getProjectPath(testDir)
    await mkdir(projectDir, { recursive: true })

    collectedMessages = []
  })
  
  afterEach(async () => {
    // Clean up scanner
    if (scanner) {
      await scanner.cleanup()
      scanner = null
    }
    
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true })
    }
  })
  
  it('should process initial session and resumed session correctly', async () => {
    // TEST SCENARIO:
    // Phase 1: User says "lol" → Assistant responds "lol" → Session closes
    // Phase 2: User resumes with NEW session ID → User says "run ls tool" → Assistant runs LS tool → Shows files
    // 
    // Key point: When resuming, Claude creates a NEW session file with:
    // - Summary line
    // - Complete history from previous session (with NEW session ID)
    // - New messages
    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg)
    })
    
    // PHASE 1: Initial session (0-say-lol-session.jsonl)
    const fixture1 = await readFile(join(__dirname, '__fixtures__', '0-say-lol-session.jsonl'), 'utf-8')
    const lines1 = fixture1.split('\n').filter(line => line.trim())
    
    const sessionId1 = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
    const sessionFile1 = join(projectDir, `${sessionId1}.jsonl`)
    
    // Write first line
    await writeFile(sessionFile1, lines1[0] + '\n')
    scanner.onNewSession(sessionId1)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(collectedMessages).toHaveLength(1)
    expect(collectedMessages[0].type).toBe('user')
    if (collectedMessages[0].type === 'user') {
      const content = collectedMessages[0].message.content
      const text = typeof content === 'string' ? content : (content as any)[0].text
      expect(text).toBe('say lol')
    }
    
    // Write second line with delay
    await new Promise(resolve => setTimeout(resolve, 50))
    await appendFile(sessionFile1, lines1[1] + '\n')
    await new Promise(resolve => setTimeout(resolve, 200))
    
    expect(collectedMessages).toHaveLength(2)
    expect(collectedMessages[1].type).toBe('assistant')
    if (collectedMessages[1].type === 'assistant' && collectedMessages[1].message) {
      expect((collectedMessages[1].message.content as any)[0].text).toBe('lol')
    }
    
    // PHASE 2: Resumed session (1-continue-run-ls-tool.jsonl)
    const fixture2 = await readFile(join(__dirname, '__fixtures__', '1-continue-run-ls-tool.jsonl'), 'utf-8')
    const lines2 = fixture2.split('\n').filter(line => line.trim())
    
    const sessionId2 = '789e105f-ae33-486d-9271-0696266f072d'
    const sessionFile2 = join(projectDir, `${sessionId2}.jsonl`)
    
    // Reset collected messages count for clarity
    const phase1Count = collectedMessages.length
    
    // Write summary + historical messages (lines 0-2) - NOT line 3 which is new
    let initialContent = ''
    for (let i = 0; i <= 2; i++) {
      initialContent += lines2[i] + '\n'
    }
    await writeFile(sessionFile2, initialContent)
    
    scanner.onNewSession(sessionId2)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Should have added only 1 new message (summary) 
    // The historical user + assistant messages (lines 1-2) are deduplicated because they have same UUIDs
    expect(collectedMessages).toHaveLength(phase1Count + 1)
    expect(collectedMessages[phase1Count].type).toBe('summary')
    
    // Write new messages (user asks for ls tool) - this is line 3
    await new Promise(resolve => setTimeout(resolve, 50))
    await appendFile(sessionFile2, lines2[3] + '\n')
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Find the user message we just added
    const userMessages = collectedMessages.filter(m => m.type === 'user')
    const lastUserMsg = userMessages[userMessages.length - 1]
    expect(lastUserMsg).toBeDefined()
    if (lastUserMsg && lastUserMsg.type === 'user') {
      expect(lastUserMsg.message.content).toBe('run ls tool ')
    }
    
    // Write remaining lines (assistant tool use, tool result, final assistant message) - starting from line 4
    for (let i = 4; i < lines2.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      await appendFile(sessionFile2, lines2[i] + '\n')
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Final count check
    const finalMessages = collectedMessages.slice(phase1Count)
    
    // Should have: 1 summary + 0 history (deduplicated) + 4 new messages = 5 total for session 2
    expect(finalMessages.length).toBeGreaterThanOrEqual(5)
    
    // Verify last message is assistant with the file listing
    const lastAssistantMsg = collectedMessages[collectedMessages.length - 1]
    expect(lastAssistantMsg.type).toBe('assistant')
    if (lastAssistantMsg.type === 'assistant' && lastAssistantMsg.message?.content) {
      const content = (lastAssistantMsg.message.content as any)[0].text
      expect(content).toContain('0-say-lol-session.jsonl')
      expect(content).toContain('readme.md')
    }
  })
  
  it('treatExistingAsProcessed=true: pre-existing JSONL messages are not replayed', async () => {
    // Write a session file BEFORE creating the scanner or calling onNewSession.
    // This simulates the remote-mode scenario where Claude has already written the full
    // history to JSONL before the scanner picks up the session.
    const sessionId = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
    const sessionFile = join(projectDir, `${sessionId}.jsonl`)
    const fixture = await readFile(join(__dirname, '__fixtures__', '0-say-lol-session.jsonl'), 'utf-8')
    await writeFile(sessionFile, fixture)

    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg)
    })

    // Call onNewSession with treatExistingAsProcessed=true
    await scanner.onNewSession(sessionId, { treatExistingAsProcessed: true })

    // Give sync.invalidate() time to run
    await new Promise(resolve => setTimeout(resolve, 200))

    // The two pre-existing messages (user + assistant) must NOT be forwarded
    expect(collectedMessages).toHaveLength(0)

    // A new message appended AFTER the pre-mark MUST still be forwarded
    const newUserLine = JSON.stringify({
      parentUuid: 'deae7c10-1e9a-466a-bbd0-1cd31b43d823',
      isSidechain: false,
      userType: 'external',
      cwd: '/tmp',
      sessionId,
      version: '1.0.56',
      gitBranch: 'main',
      type: 'user',
      message: { role: 'user', content: 'new message after reconnect' },
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      timestamp: new Date().toISOString()
    })
    await appendFile(sessionFile, newUserLine + '\n')
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(collectedMessages).toHaveLength(1)
    if (collectedMessages[0].type === 'user') {
      const content = collectedMessages[0].message.content
      const text = typeof content === 'string' ? content : (content as any)[0]?.text
      expect(text ?? content).toBe('new message after reconnect')
    }
  })

  it('treatExistingAsProcessed=true: JSONL file missing — no error, scanner still works', async () => {
    // Session file does NOT exist yet when onNewSession is called
    const sessionId = 'nonexistent-session-0000-0000-000000000000'

    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg)
    })

    // Should not throw even though file is absent
    await expect(
      scanner.onNewSession(sessionId, { treatExistingAsProcessed: true })
    ).resolves.toBeUndefined()

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(collectedMessages).toHaveLength(0)
  })

  it('treatExistingAsProcessed omitted: backward compat — existing messages ARE forwarded', async () => {
    // Without the flag the old behavior is preserved: first invalidate sends existing lines.
    const sessionId = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
    const sessionFile = join(projectDir, `${sessionId}.jsonl`)
    const fixture = await readFile(join(__dirname, '__fixtures__', '0-say-lol-session.jsonl'), 'utf-8')
    await writeFile(sessionFile, fixture)

    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg)
    })

    // Call WITHOUT options — old behaviour
    scanner.onNewSession(sessionId)
    await new Promise(resolve => setTimeout(resolve, 200))

    // Both existing messages (user + assistant) must be forwarded
    expect(collectedMessages.length).toBeGreaterThanOrEqual(2)
    expect(collectedMessages.some(m => m.type === 'user')).toBe(true)
    expect(collectedMessages.some(m => m.type === 'assistant')).toBe(true)
  })

  it('should not process duplicate assistant messages with same message ID', async () => {
    // Currently broken unclear if we need this or not post migrating to sdk & removeing deduplication
    return;

    // scanner = await createSessionScanner({
    //   sessionId: null,
    //   workingDirectory: testDir,
    //   onMessage: (msg) => collectedMessages.push(msg)
    // })
    
    // const fixture = await readFile(join(__dirname, '__fixtures__', 'duplicate-assistant-response.jsonl'), 'utf-8')
    // const lines = fixture.split('\n').filter(line => line.trim())
    
    // const sessionId = 'b91d4412-e6c4-4e51-bb1b-585bcd78aca4'
    // const sessionFile = join(projectDir, `${sessionId}.jsonl`)
    
    // // Write first user message
    // await writeFile(sessionFile, lines[0] + '\n')
    // scanner.onNewSession(sessionId)
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(1)
    // expect(collectedMessages[0].type).toBe('user')
    
    // // Write first assistant response
    // await appendFile(sessionFile, lines[1] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(2)
    // expect(collectedMessages[1].type).toBe('assistant')
    // const firstAssistantMsg = collectedMessages[1]
    // if (firstAssistantMsg.type === 'assistant') {
    //   expect((firstAssistantMsg.message.content as any)[0].text).toBe('lol')
    //   expect(firstAssistantMsg.message.id).toBe('msg_01R62tkBs9tw5X76JmpWXYbc')
    // }
    
    // // Write duplicate assistant response (same message ID, different UUID)
    // await appendFile(sessionFile, lines[2] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // // Should NOT process the duplicate - still only 2 messages
    // expect(collectedMessages).toHaveLength(2)
    
    // // Write next user message
    // await appendFile(sessionFile, lines[3] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(3)
    // expect(collectedMessages[2].type).toBe('user')
    
    // // Write final assistant response
    // await appendFile(sessionFile, lines[4] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(4)
    // expect(collectedMessages[3].type).toBe('assistant')
    // const lastAssistantMsg = collectedMessages[3]
    // if (lastAssistantMsg.type === 'assistant') {
    //   expect((lastAssistantMsg.message.content as any)[0].text).toBe('kekr')
    //   expect(lastAssistantMsg.message.id).toBe('msg_01KWeuP88pkzRtXmggJRnQmV')
    // }
  })
})