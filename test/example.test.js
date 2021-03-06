'use strict';

/* eslint-disable no-unused-expressions */

const expect = require('chai').expect;

const _ = require('./utils');
const jst = require('../lib');

const refs = require('./refs.schema.json');
const schema = require('./test.schema.json');

/* global describe, it */

describe('GraphQL & Protobuf', () => {
  it('should integrate seamlessly', () => {
    const fixtures = require('./fixtures');

    let serverInstance;

    return jst.parse(__dirname, refs, schema, fixtures.definitions)
      .then(() => {
        const models = _.getModels(fixtures.definitions);
        const options = _.getOptions(models, fixtures.definitions);

        const gqlCode = jst.generate(fixtures.pkgInfo, options, jst.graphqlDefs);
        const protoCode = jst.generate(fixtures.pkgInfo, options, jst.protobufDefs);

        const root = {
          something() {
            return 42;
          },
          anythingElse() {
            return {
              id: 1,
              value: 'FOO',
              values: ['baz', 'buzz'],
            };
          },
        };

        const query = `query {
          anythingElse {
            id
            value
            values
          }
        }`;

        return new Promise((resolve, reject) => {
          try {
            const graphqlSchema = _.trim(`
              type Query {
                dummy: [String]
              }
              type Mutation {
                dummy: [String]
              }
              schema {
                query: Query
                mutation: Mutation
              }
            `);

            const gql = _.makeExecutableSchema({
              typeDefs: [graphqlSchema, gqlCode],
            });

            return _.graphql(gql, query, root)
              .then(response => {
                expect(response.data).to.eql({
                  anythingElse: {
                    id: 1,
                    value: 'FOO',
                    values: ['baz', 'buzz'],
                  },
                });
                resolve();
              });
          } catch (e) {
            console.log('# GraphQL');
            console.log(gqlCode);

            reject(e);
          }
        })
          .then(() => {
            _.mockFs({
              'generated.proto': Buffer.from(protoCode),
              'external.proto': Buffer.from('message Noop {}'),
            });

            serverInstance = new _.Server();

            try {
              const protoOptions = {};
              const packageDefinition = _.loadSync('generated.proto', protoOptions);
              const packageObject = _.loadPackageDefinition(packageDefinition);

              serverInstance.addService(packageObject.foo_bar.FooBarService.service, {
                anythingElse(ctx, reply) {
                  reply(null, {});
                },
                something(ctx, reply) {
                  const validate = _.is(refs.find(x => x.id === 'Value'));

                  return Promise.resolve()
                    .then(() => validate(ctx.request))
                    .then(() => {
                      expect(ctx.request).to.eql({ example: 4.2 });
                      expect(validate.errors).to.be.null;

                      reply(null, {
                        id: 99,
                        foo: 'BAR',
                        values: ['OK'],
                      });
                    });
                },
              });

              serverInstance.bind('0.0.0.0:50051', _.ServerCredentials.createInsecure());
              serverInstance.start();

              return new Promise(done => {
                const { FooBarService } = packageObject.foo_bar;
                const gateway = new FooBarService('0.0.0.0:50051', _.credentials.createInsecure());

                const payload = {
                  value: 'OK',
                  example: 4.20,
                };

                const deadline = new Date();

                deadline.setSeconds(deadline.getSeconds() + 3);

                gateway.something(payload, { deadline }, (error, response) => {
                  const validate = _.is(schema, {
                    schemas: refs.reduce((prev, cur) => {
                      prev[cur.id] = cur;
                      return prev;
                    }, {}),
                  });

                  return Promise.resolve()
                    .then(() => validate(response))
                    .then(() => {
                      expect(error).to.be.null;
                      expect(validate.errors).to.be.null;
                      expect(response).to.eql({ id: 99, values: ['OK'] });

                      // console.log(protoCode);
                      done();
                    });
                });
              });
            } catch (e) {
              const matches = e.message.match(/line (\d+)/);

              console.log('# Protobuf');

              if (matches) {
                console.log(protoCode.trim().split('\n')
                  .map((x, l) => `${(matches[1] - 1) === l ? ' >' : '  '} ${`00${l + 1}`.substr(-2)} ${x}`)
                  .join('\n'));
              } else {
                console.log(protoCode);
              }

              throw e;
            } finally {
              _.mockFs.restore();
            }
          })
          .then(() => {
            return new Promise(done => {
              serverInstance
                ? serverInstance.tryShutdown(done)
                : done();
            });
          });
      });
  });
});
