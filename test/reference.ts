import { assert } from 'chai';

import graphql from '../src';
import gql from 'graphql-tag';

describe('previous result reference preservation', () => {
  it('will return a previous value if nothing changed in a flat object', () => {
    const previousResult = { a: 1, b: 2, c: 3, d: 4 };

    const result = graphql(
      (fieldName, root) => root[fieldName],
      gql`{ a b c }`,
      { a: 1, b: 2, c: 3 },
      null,
      null,
      { previousResult },
    );

    assert.strictEqual(result, previousResult);
  });

  it('will return a previous value if nothing chaned in a deep object', () => {
    const previousResult = {
      a: 'fake',
      b: {
        c: 'fakefake',
        d: 'fakefake',
        e: {
          f: 'fakefakefake',
        },
      },
    };

    const result = graphql(
      (_, root) => root + 'fake',
      gql`
        {
          a
          b {
            c
            d
            e { f }
          }
        }
      `,
      '',
      null,
      null,
      { previousResult },
    );

    assert.strictEqual(result, previousResult);
  });

  it('will preserve references for objects a few levels deep', () => {
    const previousResult = {
      a: 'not fake',
      extra: true,
      b: {
        c: 'not fakefake',
        d: 'fakefake',
        extra: true,
        e: {
          f: 'fakefakefake',
          extra: true,
        },
        g: {
          h: null,
          extra: true,
          i: {
            j: 'fakefakefakefake',
            extra: true,
          },
        },
      },
    };

    const result = graphql(
      (_, root) => root + 'fake',
      gql`
        {
          a
          b {
            c
            d
            e { f }
            g { h i { j } }
          }
        }
      `,
      '',
      null,
      null,
      { previousResult },
    );

    assert.deepEqual(result, {
      a: 'fake',
      b: {
        c: 'fakefake',
        d: 'fakefake',
        e: {
          f: 'fakefakefake',
          extra: true,
        },
        g: {
          h: 'fakefakefake',
          i: {
            j: 'fakefakefakefake',
            extra: true,
          },
        },
      },
    });

    assert.strictEqual(result.b.e, previousResult.b.e);
    assert.strictEqual(result.b.g.i, previousResult.b.g.i);
  });

  it('will preserve arrays that did not change', () => {
    const data = {
      a: 'hello',
      b: [
        { c: 1, d: 2, e: 3 },
        { c: 4, d: 5, e: 6 },
        { c: 7, d: 8, e: 9 },
      ],
    };

    const previousResult = {
      b: [
        { c: 1, d: 2, e: 3 },
        { c: 4, d: 5, e: 6 },
        { c: 7, d: 8, e: 9 },
      ],
    };

    const result = graphql(
      (fieldName, rootValue) => rootValue[fieldName],
      gql`
        {
          a
          b { c d e }
        }
      `,
      data,
      null,
      null,
      { previousResult },
    );

    assert.deepEqual(result, data);

    assert.strictEqual(result.b, previousResult.b);
  });

  it.skip('will preserve single array items that did not change', () => {
    const data = {
      a: 'hello',
      b: [
        { c: 1, d: 2, e: 3 },
        { c: 4, d: 5, e: 6 },
        { c: 7, d: 8, e: 9 },
      ],
    };

    const previousResult = {
      b: [
        { c: 10, d: 20, e: 30 },
        { c: 4, d: 5, e: 6 },
        { c: 70, d: 80, e: 90 },
      ],
    };

    const result = graphql(
      (fieldName, rootValue) => rootValue[fieldName],
      gql`
        a
        b { c d e }
      `,
      data,
      null,
      null,
      { previousResult },
    );

    assert.deepEqual(result, data);

    assert.strictEqual(result.b[1], previousResult.b[1]);
  });
});
