import {
  Document,
  SelectionSet,
  Field,
  FragmentDefinition,
  InlineFragment,
} from 'graphql';

import {
  getMainDefinition,
  getFragmentDefinitions,
  createFragmentMap,
  FragmentMap,
} from './getFromAST';

import {
  shouldInclude,
} from './directives';

import {
  isField,
  isInlineFragment,
  resultKeyNameFromField,
  argumentsObjectFromField,
} from './storeUtils';

export {
  filter,
  check,
  propType,
} from './utilities';

export type Resolver = (
  fieldName: string,
  rootValue: any,
  args: any,
  context: any,
  info: ExecInfo
) => any;

export type VariableMap = { [name: string]: any };

export type ResultMapper = (values: {[fieldName: string]: any}, rootValue: any) => any;
export type FragmentMatcher = (rootValue: any, typeCondition: string, context: any) => boolean;

export type ExecContext = {
  fragmentMap: FragmentMap;
  contextValue: any;
  variableValues: VariableMap;
  resultMapper: ResultMapper;
  resolver: Resolver;
  fragmentMatcher: FragmentMatcher;
}

export type ExecInfo = {
  isLeaf: boolean;
  resultKey: string;
}

export type ExecOptions = {
  resultMapper?: ResultMapper;
  fragmentMatcher?: FragmentMatcher;
  previousResult?: any;
}

// Based on graphql function from graphql-js:
// graphql(
//   schema: GraphQLSchema,
//   requestString: string,
//   rootValue?: ?any,
//   contextValue?: ?any,
//   variableValues?: ?{[key: string]: any},
//   operationName?: ?string
// ): Promise<GraphQLResult>
export default function graphql(
  resolver: Resolver,
  document: Document,
  rootValue?: any,
  contextValue?: any,
  variableValues?: VariableMap,
  execOptions: ExecOptions = {},
) {
  const mainDefinition = getMainDefinition(document);

  const fragments = getFragmentDefinitions(document);
  const fragmentMap = createFragmentMap(fragments) || {};

  const {
    resultMapper,
    // Default matcher always matches all fragments
    fragmentMatcher = () => true,
    previousResult = null,
  } = execOptions;

  const execContext: ExecContext = {
    fragmentMap,
    contextValue,
    variableValues,
    resultMapper,
    resolver,
    fragmentMatcher,
  };

  return executeSelectionSet(
    mainDefinition.selectionSet,
    rootValue,
    previousResult,
    execContext,
  );
}

function executeSelectionSet(
  selectionSet: SelectionSet,
  rootValue: any,
  previousResult: any,
  execContext: ExecContext
) {
  const {
    fragmentMap,
    contextValue,
    variableValues: variables,
  } = execContext;

  // If we `previousResult` is nullish then we know beforehand that the result has been modified
  // without needing to look at our selections. If we have an object for `previousResult` then we
  // have yet to tell if it has been changed.
  let resultModified = previousResult == null;

  const result = {};

  selectionSet.selections.forEach((selection) => {
    if (! shouldInclude(selection, variables)) {
      // Skip this entirely
      return;
    }

    if (isField(selection)) {
      const fieldResult = executeField(
        selection,
        rootValue,
        previousResult,
        execContext,
      );

      const resultFieldKey = resultKeyNameFromField(selection);

      if (previousResult && fieldResult !== previousResult[resultFieldKey]) {
        resultModified = true;
      }

      if (fieldResult !== undefined) {
        result[resultFieldKey] = fieldResult;
      }
    } else {
      let fragment: InlineFragment | FragmentDefinition;

      if (isInlineFragment(selection)) {
        fragment = selection;
      } else {
        // This is a named fragment
        fragment = fragmentMap[selection.name.value];

        if (!fragment) {
          throw new Error(`No fragment named ${selection.name.value}`);
        }
      }

      const typeCondition = fragment.typeCondition.name.value;

      if (execContext.fragmentMatcher(rootValue, typeCondition, contextValue)) {
        const fragmentResult = executeSelectionSet(
          fragment.selectionSet,
          rootValue,
          previousResult,
          execContext,
        );

        if (fragmentResult !== previousResult) {
          resultModified = true;
        }

        merge(result, fragmentResult);
      }
    }
  });

  if (execContext.resultMapper) {
    return execContext.resultMapper(result, rootValue);
  }

  // If the result was not modified this entire time, just return the previous result so we may
  // maintain referential equality.
  return resultModified ? result : previousResult;
}

function executeField(
  field: Field,
  rootValue: any,
  previousResult: any,
  execContext: ExecContext,
): any {
  const {
    variableValues: variables,
    contextValue,
    resolver,
  } = execContext;

  const fieldName = field.name.value;
  const args = argumentsObjectFromField(field, variables);
  const resultKey = resultKeyNameFromField(field);

  const info: ExecInfo = {
    isLeaf: ! field.selectionSet,
    resultKey,
  };

  const result = resolver(fieldName, rootValue, args, contextValue, info);

  // Handle all scalar types here
  if (! field.selectionSet) {
    return result;
  }

  // From here down, the field has a selection set, which means it's trying to
  // query a GraphQLObjectType
  if (result === null || typeof result === 'undefined') {
    // Basically any field in a GraphQL response can be null, or missing
    return result;
  }

  if (Array.isArray(result)) {
    return executeSubSelectedArray(
      field,
      result,
      previousResult ? previousResult[resultKey] : null,
      execContext,
    );
  }

  // Returned value is an object, and the query has a sub-selection. Recurse.
  return executeSelectionSet(
    field.selectionSet,
    result,
    previousResult ? previousResult[resultKey] : null,
    execContext,
  );
}

function executeSubSelectedArray(
  field,
  result,
  previousResult,
  execContext,
) {
  let resultModified = previousResult == null;

  const nextResult = result.map((item, i) => {
    // null value in array
    if (item === null) {
      return null;
    }

    // This is a nested array, recurse
    if (Array.isArray(item)) {
      return executeSubSelectedArray(
        field,
        item,
        previousResult ? previousResult[i] : null,
        execContext,
      );
    }

    // This is an object, run the selection set on it
    const nextItem = executeSelectionSet(
      field.selectionSet,
      item,
      previousResult ? previousResult[i] : null,
      execContext,
    );

    if (previousResult && nextItem !== previousResult[i]) {
      resultModified = true;
    }

    return nextItem;
  });

  return resultModified ? nextResult : previousResult;
}

function merge(dest, src) {
  if (
    src === null ||
    typeof src === 'undefined' ||
    typeof src === 'string' ||
    typeof src === 'number' ||
    typeof src === 'boolean' ||
    Array.isArray(src)
  ) {
    // These types just override whatever was in dest
    return src;
  }

  // Merge sub-objects
  Object.keys(dest).forEach((destKey) => {
    if (src.hasOwnProperty(destKey)) {
      merge(dest[destKey], src[destKey]);
    }
  });

  // Add props only on src
  Object.keys(src).forEach((srcKey) => {
    if (! dest.hasOwnProperty(srcKey)) {
      dest[srcKey] = src[srcKey];
    }
  });
}
