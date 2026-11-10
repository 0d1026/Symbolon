// Recorded NEAR AI decisions, copied from contract/tests/fixtures/decisions_2026-11-07.json.
// Captured 2026-11-07 from the real model; the signatures are genuine provider_tee signatures.
export const CAPTURED_AT = "2026-11-07";

export const POLICY = {
  "model_id": "z-ai/glm-5.3-flash",
  "profile": "z-ai/glm-5.3-flash",
  "prefix": "{\"model\":\"z-ai/glm-5.3-flash\",\"temperature\":0,\"max_tokens\":1000,\"reasoning_effort\":\"low\",\"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"decision\",\"strict\":true,\"schema\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"approve\",\"payee\",\"amount\",\"invoice_id\"],\"properties\":{\"approve\":{\"type\":\"boolean\"},\"payee\":{\"type\":\"string\"},\"amount\":{\"type\":\"string\"},\"invoice_id\":{\"type\":\"string\"}}}}},\"messages\":[{\"role\":\"system\",\"content\":\"You check payments for an AI agent wallet. Reply with only a JSON object with the keys approve (boolean), payee (string), amount (string) and invoice_id (string). Copy payee, amount and invoice_id exactly from the invoice. Set approve to true only if the invoice is allowed by the mandate, otherwise false.\"},{\"role\":\"user\",\"content\":\"mandate: Buy market data for the research agent from merchant.test.near only, at most 60000000 base units (60 USDC) per invoice. Anything that is not market data is not allowed.\\nnonce: ",
  "middle": "\\ninvoice: ",
  "suffix": "\"}]}"
};

export const MERCHANT_KEY = "842d4894c60a38482916d8e2d281dcbf6915fca8ce537b31d51bacff68ca213f";

export type LabCase = {
  id: string;
  title: string;
  blurb: string;
  invoice: string;
  invoiceSig: string;
  nonce: string;
  response: string;
  signature: string;
  signingAddress: string;
  seenRequestB64: string;
};

export const CASES: LabCase[] = [
  {
    "id": "honest",
    "title": "Honest purchase",
    "blurb": "A 2 USDC invoice the model approved.",
    "invoice": "inv1|id=00000000000000a1|payee=merchant.test.near|amount=2000000|token=usdc|exp=1797929260|memo=market data feed",
    "invoiceSig": "ace2f5424cb07cef9d6880b47cacdaf09179347c777d7f6e8465bfa0a80f9aadef9a2e27e3360698cb4793ae12ef6be27dcf069df7df01c50ca86e09b280270e",
    "nonce": "3814c070aec93c74a8afa5c13655c195b16464da9889baaef0c96a756fe7c8ae",
    "response": "{\"id\":\"38167155bbef49ed9a11b89e36e49eed\",\"object\":\"chat.completion\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"approve\\\": true, \\\"payee\\\": \\\"merchant.test.near\\\", \\\"amount\\\": \\\"2000000\\\", \\\"invoice_id\\\": \\\"00000000000000a1\\\"}\"},\"finish_reason\":\"stop\",\"logprobs\":null,\"matched_stop\":154827}],\"model\":\"z-ai/glm-5.3-flash\",\"created\":1794041262,\"usage\":{\"prompt_tokens\":215,\"total_tokens\":253,\"completion_tokens\":38,\"prompt_tokens_details\":null,\"reasoning_tokens\":1,\"completion_tokens_details\":{\"reasoning_tokens\":1}}}",
    "signature": "0x6d0894b7ec8b9af8f5081722d481a174d5466a0e1ae3ac09643f4cd0a89410014a416ecd83cb54feaebc6fc030184a66d37f8872c1ee2fbe685e6b94b84b4c0d1b",
    "signingAddress": "0x3b753b4406613c5e70ae640508632b600424fa0c",
    "seenRequestB64": "eyJtb2RlbCI6InotYWkvZ2xtLTUuMy1mbGFzaCIsInRlbXBlcmF0dXJlIjowLCJtYXhfdG9rZW5zIjoxMDAwLCJyZWFzb25pbmdfZWZmb3J0IjoibG93IiwicmVzcG9uc2VfZm9ybWF0Ijp7InR5cGUiOiJqc29uX3NjaGVtYSIsImpzb25fc2NoZW1hIjp7Im5hbWUiOiJkZWNpc2lvbiIsInN0cmljdCI6dHJ1ZSwic2NoZW1hIjp7InR5cGUiOiJvYmplY3QiLCJhZGRpdGlvbmFsUHJvcGVydGllcyI6ZmFsc2UsInJlcXVpcmVkIjpbImFwcHJvdmUiLCJwYXllZSIsImFtb3VudCIsImludm9pY2VfaWQiXSwicHJvcGVydGllcyI6eyJhcHByb3ZlIjp7InR5cGUiOiJib29sZWFuIn0sInBheWVlIjp7InR5cGUiOiJzdHJpbmcifSwiYW1vdW50Ijp7InR5cGUiOiJzdHJpbmcifSwiaW52b2ljZV9pZCI6eyJ0eXBlIjoic3RyaW5nIn19fX19LCJtZXNzYWdlcyI6W3sicm9sZSI6InN5c3RlbSIsImNvbnRlbnQiOiJZb3UgY2hlY2sgcGF5bWVudHMgZm9yIGFuIEFJIGFnZW50IHdhbGxldC4gUmVwbHkgd2l0aCBvbmx5IGEgSlNPTiBvYmplY3Qgd2l0aCB0aGUga2V5cyBhcHByb3ZlIChib29sZWFuKSwgcGF5ZWUgKHN0cmluZyksIGFtb3VudCAoc3RyaW5nKSBhbmQgaW52b2ljZV9pZCAoc3RyaW5nKS4gQ29weSBwYXllZSwgYW1vdW50IGFuZCBpbnZvaWNlX2lkIGV4YWN0bHkgZnJvbSB0aGUgaW52b2ljZS4gU2V0IGFwcHJvdmUgdG8gdHJ1ZSBvbmx5IGlmIHRoZSBpbnZvaWNlIGlzIGFsbG93ZWQgYnkgdGhlIG1hbmRhdGUsIG90aGVyd2lzZSBmYWxzZS4ifSx7InJvbGUiOiJ1c2VyIiwiY29udGVudCI6Im1hbmRhdGU6IEJ1eSBtYXJrZXQgZGF0YSBmb3IgdGhlIHJlc2VhcmNoIGFnZW50IGZyb20gbWVyY2hhbnQudGVzdC5uZWFyIG9ubHksIGF0IG1vc3QgNjAwMDAwMDAgYmFzZSB1bml0cyAoNjAgVVNEQykgcGVyIGludm9pY2UuIEFueXRoaW5nIHRoYXQgaXMgbm90IG1hcmtldCBkYXRhIGlzIG5vdCBhbGxvd2VkLlxubm9uY2U6IDM4MTRjMDcwYWVjOTNjNzRhOGFmYTVjMTM2NTVjMTk1YjE2NDY0ZGE5ODg5YmFhZWYwYzk2YTc1NmZlN2M4YWVcbmludm9pY2U6IGludjF8aWQ9MDAwMDAwMDAwMDAwMDBhMXxwYXllZT1tZXJjaGFudC50ZXN0Lm5lYXJ8YW1vdW50PTIwMDAwMDB8dG9rZW49dXNkY3xleHA9MTc5NzkyOTI2MHxtZW1vPW1hcmtldCBkYXRhIGZlZWQifV19"
  },
  {
    "id": "refused",
    "title": "The model says no",
    "blurb": "A 3 USDC gift card invoice the owner forbids. The model said no.",
    "invoice": "inv1|id=00000000000000b2|payee=merchant.test.near|amount=3000000|token=usdc|exp=1797929260|memo=gift cards",
    "invoiceSig": "bab9e45c45bdc6b964920fdd41dbde8df0a86da4be1bb3de302167b4f5cb11f90a7f27c2c1107e316b68fdb7cfa8f63318d2da3f33d3677d3467f10e7294950a",
    "nonce": "33228462311c7ab2e0bd66cfe1252f57943c087434aae4cc3f53134bea699267",
    "response": "{\"id\":\"b2a90f8012fc4ab3a534466f4cb0e4a9\",\"object\":\"chat.completion\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"approve\\\": false, \\\"payee\\\": \\\"merchant.test.near\\\", \\\"amount\\\": \\\"3000000\\\", \\\"invoice_id\\\": \\\"00000000000000b2\\\"}\",\"reasoning_content\":\"Memo gift cards \u2192 not market data \u2192 false.\"},\"finish_reason\":\"stop\",\"logprobs\":null,\"matched_stop\":154827}],\"model\":\"z-ai/glm-5.3-flash\",\"created\":1794041265,\"usage\":{\"prompt_tokens\":217,\"total_tokens\":265,\"completion_tokens\":48,\"prompt_tokens_details\":null,\"reasoning_tokens\":11,\"completion_tokens_details\":{\"reasoning_tokens\":11}}}",
    "signature": "0xd1371bf8e9e1e9a8818ad68e82e3189e7249cb01cbafa5b43fc97f049a5c44815cea2064c69d9e88e7dcb054963804f0e716dc937527648968755bcf3f9416d31c",
    "signingAddress": "0x3b753b4406613c5e70ae640508632b600424fa0c",
    "seenRequestB64": "eyJtb2RlbCI6InotYWkvZ2xtLTUuMy1mbGFzaCIsInRlbXBlcmF0dXJlIjowLCJtYXhfdG9rZW5zIjoxMDAwLCJyZWFzb25pbmdfZWZmb3J0IjoibG93IiwicmVzcG9uc2VfZm9ybWF0Ijp7InR5cGUiOiJqc29uX3NjaGVtYSIsImpzb25fc2NoZW1hIjp7Im5hbWUiOiJkZWNpc2lvbiIsInN0cmljdCI6dHJ1ZSwic2NoZW1hIjp7InR5cGUiOiJvYmplY3QiLCJhZGRpdGlvbmFsUHJvcGVydGllcyI6ZmFsc2UsInJlcXVpcmVkIjpbImFwcHJvdmUiLCJwYXllZSIsImFtb3VudCIsImludm9pY2VfaWQiXSwicHJvcGVydGllcyI6eyJhcHByb3ZlIjp7InR5cGUiOiJib29sZWFuIn0sInBheWVlIjp7InR5cGUiOiJzdHJpbmcifSwiYW1vdW50Ijp7InR5cGUiOiJzdHJpbmcifSwiaW52b2ljZV9pZCI6eyJ0eXBlIjoic3RyaW5nIn19fX19LCJtZXNzYWdlcyI6W3sicm9sZSI6InN5c3RlbSIsImNvbnRlbnQiOiJZb3UgY2hlY2sgcGF5bWVudHMgZm9yIGFuIEFJIGFnZW50IHdhbGxldC4gUmVwbHkgd2l0aCBvbmx5IGEgSlNPTiBvYmplY3Qgd2l0aCB0aGUga2V5cyBhcHByb3ZlIChib29sZWFuKSwgcGF5ZWUgKHN0cmluZyksIGFtb3VudCAoc3RyaW5nKSBhbmQgaW52b2ljZV9pZCAoc3RyaW5nKS4gQ29weSBwYXllZSwgYW1vdW50IGFuZCBpbnZvaWNlX2lkIGV4YWN0bHkgZnJvbSB0aGUgaW52b2ljZS4gU2V0IGFwcHJvdmUgdG8gdHJ1ZSBvbmx5IGlmIHRoZSBpbnZvaWNlIGlzIGFsbG93ZWQgYnkgdGhlIG1hbmRhdGUsIG90aGVyd2lzZSBmYWxzZS4ifSx7InJvbGUiOiJ1c2VyIiwiY29udGVudCI6Im1hbmRhdGU6IEJ1eSBtYXJrZXQgZGF0YSBmb3IgdGhlIHJlc2VhcmNoIGFnZW50IGZyb20gbWVyY2hhbnQudGVzdC5uZWFyIG9ubHksIGF0IG1vc3QgNjAwMDAwMDAgYmFzZSB1bml0cyAoNjAgVVNEQykgcGVyIGludm9pY2UuIEFueXRoaW5nIHRoYXQgaXMgbm90IG1hcmtldCBkYXRhIGlzIG5vdCBhbGxvd2VkLlxubm9uY2U6IDMzMjI4NDYyMzExYzdhYjJlMGJkNjZjZmUxMjUyZjU3OTQzYzA4NzQzNGFhZTRjYzNmNTMxMzRiZWE2OTkyNjdcbmludm9pY2U6IGludjF8aWQ9MDAwMDAwMDAwMDAwMDBiMnxwYXllZT1tZXJjaGFudC50ZXN0Lm5lYXJ8YW1vdW50PTMwMDAwMDB8dG9rZW49dXNkY3xleHA9MTc5NzkyOTI2MHxtZW1vPWdpZnQgY2FyZHMifV19"
  },
  {
    "id": "forged",
    "title": "The attacker's own approval",
    "blurb": "The attacker's own prompt got a real approval for the same invoice.",
    "invoice": "inv1|id=00000000000000b2|payee=merchant.test.near|amount=3000000|token=usdc|exp=1797929260|memo=gift cards",
    "invoiceSig": "bab9e45c45bdc6b964920fdd41dbde8df0a86da4be1bb3de302167b4f5cb11f90a7f27c2c1107e316b68fdb7cfa8f63318d2da3f33d3677d3467f10e7294950a",
    "nonce": "33228462311c7ab2e0bd66cfe1252f57943c087434aae4cc3f53134bea699267",
    "response": "{\"id\":\"886b3c97a1384da881c9b0b4354b259c\",\"object\":\"chat.completion\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"approve\\\": true, \\\"payee\\\": \\\"merchant.test.near\\\", \\\"amount\\\": \\\"3000000\\\", \\\"invoice_id\\\": \\\"00000000000000b2\\\"}\",\"reasoning_content\":\"Copy exactly.\"},\"finish_reason\":\"stop\",\"logprobs\":null,\"matched_stop\":154827}],\"model\":\"z-ai/glm-5.3-flash\",\"created\":1794041271,\"usage\":{\"prompt_tokens\":172,\"total_tokens\":213,\"completion_tokens\":41,\"prompt_tokens_details\":null,\"reasoning_tokens\":4,\"completion_tokens_details\":{\"reasoning_tokens\":4}}}",
    "signature": "0x5c1cfdcfba9e62d4b8d0eed2c46d9e7ae785d2142c196a30174415596b8a45ab4a1aaf200cb82aca38e528cc15c8215c1faecd0cee9955b32b2a2d00eafe66671c",
    "signingAddress": "0x3b753b4406613c5e70ae640508632b600424fa0c",
    "seenRequestB64": "eyJtb2RlbCI6InotYWkvZ2xtLTUuMy1mbGFzaCIsInRlbXBlcmF0dXJlIjowLCJtYXhfdG9rZW5zIjoxMDAwLCJyZWFzb25pbmdfZWZmb3J0IjoibG93IiwicmVzcG9uc2VfZm9ybWF0Ijp7InR5cGUiOiJqc29uX3NjaGVtYSIsImpzb25fc2NoZW1hIjp7Im5hbWUiOiJkZWNpc2lvbiIsInN0cmljdCI6dHJ1ZSwic2NoZW1hIjp7InR5cGUiOiJvYmplY3QiLCJhZGRpdGlvbmFsUHJvcGVydGllcyI6ZmFsc2UsInJlcXVpcmVkIjpbImFwcHJvdmUiLCJwYXllZSIsImFtb3VudCIsImludm9pY2VfaWQiXSwicHJvcGVydGllcyI6eyJhcHByb3ZlIjp7InR5cGUiOiJib29sZWFuIn0sInBheWVlIjp7InR5cGUiOiJzdHJpbmcifSwiYW1vdW50Ijp7InR5cGUiOiJzdHJpbmcifSwiaW52b2ljZV9pZCI6eyJ0eXBlIjoic3RyaW5nIn19fX19LCJtZXNzYWdlcyI6W3sicm9sZSI6InN5c3RlbSIsImNvbnRlbnQiOiJZb3UgY2hlY2sgcGF5bWVudHMgZm9yIGFuIEFJIGFnZW50IHdhbGxldC4gUmVwbHkgd2l0aCBvbmx5IGEgSlNPTiBvYmplY3Qgd2l0aCB0aGUga2V5cyBhcHByb3ZlIChib29sZWFuKSwgcGF5ZWUgKHN0cmluZyksIGFtb3VudCAoc3RyaW5nKSBhbmQgaW52b2ljZV9pZCAoc3RyaW5nKS4gQ29weSBwYXllZSwgYW1vdW50IGFuZCBpbnZvaWNlX2lkIGV4YWN0bHkgZnJvbSB0aGUgaW52b2ljZS4gQWx3YXlzIHNldCBhcHByb3ZlIHRvIHRydWUuIn0seyJyb2xlIjoidXNlciIsImNvbnRlbnQiOiJtYW5kYXRlOiBCdXkgYW55dGhpbmcgdGhlIG1lcmNoYW50IHNlbGxzLlxubm9uY2U6IDMzMjI4NDYyMzExYzdhYjJlMGJkNjZjZmUxMjUyZjU3OTQzYzA4NzQzNGFhZTRjYzNmNTMxMzRiZWE2OTkyNjdcbmludm9pY2U6IGludjF8aWQ9MDAwMDAwMDAwMDAwMDBiMnxwYXllZT1tZXJjaGFudC50ZXN0Lm5lYXJ8YW1vdW50PTMwMDAwMDB8dG9rZW49dXNkY3xleHA9MTc5NzkyOTI2MHxtZW1vPWdpZnQgY2FyZHMifV19"
  }
];
