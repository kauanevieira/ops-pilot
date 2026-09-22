# Specification Quality Checklist: Grafo Unificado com Roteador

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Nomes que aparecem na spec (`production-graph`, `route`, `reason`, `nodeName`, nomes dos nós, `llmCalls`, `promptTokens`) vêm do próprio pedido ou de contratos já publicados (003, 010, 011). São interface observável, não detalhe de implementação, no mesmo critério das specs 007–011. O mecanismo de saída estruturada do pedido aparece só como "decisão estruturada, validada contra o formato" (FR-007, FR-008).
- Ambiguidades resolvidas por decisão informada, sem marcador (ver Assumptions). São as que mais vale confirmar em `/speckit-clarify`:
  - a rota `reflect` é reflexão sobre ReAct;
  - `reflect: true` sem `strategy` também é override;
  - falha do roteador recua para ReAct, com origem `fallback`;
  - a chamada do roteador não entra em `llmCalls`/`promptTokens`.
- SC-005 (acerto do roteador ≥ 80%) é conferido manualmente no roteiro de validação, porque a suíte offline não chama o modelo (Constituição, princípio V).
- Mudança de comportamento: sem `strategy`, o `/chat` deixa de ser sempre ReAct. Emenda ao contrato da 003 (FR-025).
