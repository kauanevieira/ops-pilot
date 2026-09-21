import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSecret } from "./secret-guard.ts";

describe("looksLikeSecret — positivos (G1-G6)", () => {
  const positives: Record<string, string> = {
    "G1 - OpenRouter/OpenAI-style key": "minha chave é sk-or-v1-8f3a9c2e1b7d4a6f0c5e9b2d1a8f7c6e5d4b3a2c",
    "G1 - GitHub PAT": "usa ghp_1234567890abcdefghijklmnopqrstuv no CI",
    "G1 - GitHub fine-grained PAT": "token: github_pat_11ABCDEFG0123456789abcdefghijklmnop",
    "G1 - GitLab PAT": "glpat-aBcDeFgHiJkLmNoPqRsT",
    "G1 - Slack token": "xoxb-EXEMPLO-NAO-E-TOKEN-REAL",
    "G1 - AWS access key id": "AKIAIOSFODNN7EXAMPLE",
    "G1 - Google API key": "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWQ",
    "G2 - JWT": "Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dQw4w9WgXcQ-abcdefghij",
    "G3 - PEM private key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    "G4 - URL credential": "string de conexão: postgres://app:s3nh4@db.internal:5432/prod",
    "G5 - senha com valor (pt)": "a senha do grafana é Pr0d!2024",
    "G5 - password com valor (en)": "the password is Sup3rSecret!",
    "G5 - api key com valor": "api_key = abcd1234efgh5678",
    "G6 - sequência de alta entropia": "guarda isso: 9fK2xQ7mZp4LwR8tVb3N",
  };

  for (const [name, text] of Object.entries(positives)) {
    it(`${name}: "${text}"`, () => {
      assert.equal(looksLikeSecret(text), true);
    });
  }

  it("falso positivo aceito por desenho: 'A senha é pedida pelo SSO toda segunda.' (spec, Assumptions)", () => {
    assert.equal(looksLikeSecret("A senha é pedida pelo SSO toda segunda."), true);
  });
});

describe("looksLikeSecret — negativos", () => {
  const negatives: Record<string, string> = {
    "fato durável comum": "É do time de pagamentos.",
    "menção a chave sem valor": "Responde pela rotação de chaves do vault.",
    "menção a token sem valor": "Prefere explicações sobre tokens JWT.",
    "fuso horário": "Trabalha no turno das 22h às 6h, fuso America/Sao_Paulo.",
    "nome de serviço": "Cuida do serviço payments-gateway-v2.",
    "pedido operacional comum": "quais alertas estão abertos?",
    "frase longa sem forma de credencial": "Prefere respostas curtas e diretas, sem rodeios nem jargão técnico.",
  };

  for (const [name, text] of Object.entries(negatives)) {
    it(`${name}: "${text}"`, () => {
      assert.equal(looksLikeSecret(text), false);
    });
  }
});

describe("looksLikeSecret — S1/S2", () => {
  it("string vazia nunca é segredo (S1)", () => {
    assert.equal(looksLikeSecret(""), false);
  });

  it("nunca lança para entradas estranhas (S2)", () => {
    assert.doesNotThrow(() => looksLikeSecret("   "));
    assert.doesNotThrow(() => looksLikeSecret("🔒🔑"));
    assert.doesNotThrow(() => looksLikeSecret("a".repeat(10_000)));
  });
});
