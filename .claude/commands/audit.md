# Code Audit Command

Ultrathink and conduct a comprehensive technical audit of the relevant systems and code. Rate production readiness on a 1-10 scale.

## Rating Criteria (1-10 scale)

### 1. Production Quality Code
- **Readability**: Clear naming, logical structure, self-documenting code
- **Error Handling**: Comprehensive error catching, graceful degradation, meaningful error messages
- **Performance**: Efficient algorithms, optimized queries, minimal overhead
- **Documentation**: JSDoc comments, inline explanations for complex logic
- **Type Safety**: NO `any` or `unknown` types - strong typing throughout

### 2. Best Practices
- **Code Organization**: Logical file structure, separation of concerns
- **DRY Principle**: No code duplication, shared utilities
- **KISS Principle**: Simple solutions, no over-engineering
- **Testing Coverage**: Unit tests, integration tests, edge case coverage

### 3. OWASP Security Standards
- **Injection Prevention**: Parameterized queries, input sanitization
- **Authentication**: Secure session management, proper token handling
- **Access Control**: Role-based permissions, principle of least privilege
- **Input Validation**: Server-side validation, type checking, bounds checking
- **Rate Limiting**: API throttling, abuse prevention

### 4. Game Studio Audit
Would this pass review at a AAA studio?
- **Anti-Cheat**: Server authority, validation of client actions
- **Server Authority**: Critical game logic server-side, client is untrusted
- **Scalability**: Horizontal scaling support, efficient resource usage

### 5. Memory & Allocation Hygiene
- **No allocations in hot paths**: Update loops, physics, rendering must be allocation-free
- **Pre-allocated private reusables**: Vectors, quaternions, matrices, temporary objects
- **Object pooling**: Frequently spawned/despawned entities use pools
- **GC pressure avoidance**: No `new` in 60fps code paths
- **Buffer reuse**: Typed arrays and buffers reused where applicable

### 6. SOLID Principles
- **Single Responsibility Principle (SRP)**: Each class/function has one job
- **Open/Closed Principle (OCP)**: Open for extension, closed for modification
- **Liskov Substitution Principle (LSP)**: Subtypes are substitutable for base types
- **Interface Segregation Principle (ISP)**: No forced dependency on unused interfaces
- **Dependency Inversion Principle (DIP)**: Depend on abstractions, not concretions

## Output Format

Provide:
1. **Overall Score**: X/10 with brief justification
2. **Category Scores**: Score each of the 6 categories above
3. **Critical Issues**: List any blockers for production
4. **Recommendations**: Prioritized list of improvements
5. **Strengths**: What's already done well
