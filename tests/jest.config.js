// Jest uruchamia tylko testy API (*.test.js); pliki *.spec.js należą do Playwrighta.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  // Pierwsze żądanie po przerwie budzi backend (Container Apps skaluje się do zera) – nawet ~20 s.
  testTimeout: 30_000,
}
