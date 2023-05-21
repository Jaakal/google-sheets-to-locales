const { google } = require('googleapis');
const sheets = google.sheets('v4');
const fs = require('fs');

const apiKey = '';
const spreadsheetId = '';
const outputDirectory = '';

function lowercaseFirstLetter(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function createDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInitializedArrayOfLengthFromArray(length, baseArray) {
  const newArray = Array.from({ length }, () => ({}));
  const maxIndex = Math.min(length, baseArray.length);

  for (let index = 0; index < maxIndex; index++) {
    newArray[index] = baseArray[index];
  }

  return newArray;
}

function initializeArrayEmptyValues(currentTreeDepth, selector, defaultValue) {
  for (const [index] of currentTreeDepth[selector].entries()) {
    currentTreeDepth[selector][index] ||= createDeepCopy(defaultValue);
  }
}

function ensureTreeDepthExists(
  currentTreeDepth,
  defaultValue,
  selector,
  arrayIndex
) {
  const isRegularSelector = arrayIndex === undefined;

  if (isRegularSelector) {
    currentTreeDepth[selector] ||= defaultValue;
    return;
  }

  currentTreeDepth[selector][arrayIndex] ||= defaultValue;
}

function destructureArraySelector(selector) {
  const destructureArraySelectorRegex = /[\[\]]/;
  const [_selector, arrayIndexString] = selector.split(
    destructureArraySelectorRegex
  );
  const arrayIndex =
    arrayIndexString.length > 0 ? parseInt(arrayIndexString, 10) : null;

  return { selector: _selector, arrayIndex };
}

function resolveIntermediateArraySelector(
  currentTreeDepth,
  selector,
  arrayIndex
) {
  const isArrayIndexDefined = arrayIndex !== null;

  if (isArrayIndexDefined) {
    ensureTreeDepthExists(currentTreeDepth, {}, selector, arrayIndex);
    initializeArrayEmptyValues(currentTreeDepth, selector, {});
    return currentTreeDepth[selector][arrayIndex];
  }

  currentTreeDepth[selector].push({});

  return currentTreeDepth[selector][currentTreeDepth[selector].length - 1];
}

function resolveEndingArraySelector(
  currentTreeDepth,
  selector,
  arrayIndex,
  value
) {
  const isArrayIndexDefined = arrayIndex !== null;

  if (isArrayIndexDefined) {
    currentTreeDepth[selector][arrayIndex] = value;
    initializeArrayEmptyValues(currentTreeDepth, selector, '');
  } else {
    currentTreeDepth[selector].push(value);
  }
}

function resolveArraySelector(
  isLastSelector,
  currentTreeDepth,
  rawSelector,
  value
) {
  const { selector, arrayIndex } = destructureArraySelector(rawSelector);

  ensureTreeDepthExists(currentTreeDepth, [], selector);

  if (isLastSelector) {
    resolveEndingArraySelector(currentTreeDepth, selector, arrayIndex, value);
  } else {
    return resolveIntermediateArraySelector(
      currentTreeDepth,
      selector,
      arrayIndex
    );
  }
}

function resolveRegularSelector(
  isLastSelector,
  currentTreeDepth,
  selector,
  value
) {
  if (isLastSelector) {
    currentTreeDepth[selector] = value;
    return;
  }

  ensureTreeDepthExists(currentTreeDepth, {}, selector);

  return currentTreeDepth[selector];
}

function createSelectorTree(currentTreeDepth, selectorTree, value) {
  const detectArraySelectorRegex = /\[[^\]]*\]/;
  let _currentTreeDepth = currentTreeDepth;

  selectorTree.forEach((selector, selectorIndex) => {
    const isRegularSelector = !detectArraySelectorRegex.test(selector);
    const isLastSelector = selectorIndex === selectorTree.length - 1;

    if (isRegularSelector) {
      _currentTreeDepth = resolveRegularSelector(
        isLastSelector,
        _currentTreeDepth,
        selector,
        value
      );
      return;
    }

    _currentTreeDepth = resolveArraySelector(
      isLastSelector,
      _currentTreeDepth,
      selector,
      value
    );
  });
}

function parseCopyRowData(
  copyRowData,
  sheetLocales,
  localesJsObject,
  sheetTitle
) {
  const selectorString = copyRowData.values[0].effectiveValue?.stringValue;
  const selectorStringDoesNotExist = selectorString === undefined;

  if (selectorStringDoesNotExist) {
    return;
  }

  const selectorTree = selectorString.split('.');

  copyRowData.values.slice(1).forEach(({ effectiveValue }, index) => {
    const currentTreeDepth = localesJsObject[sheetLocales[index]][sheetTitle];
    createSelectorTree(
      currentTreeDepth,
      selectorTree,
      effectiveValue?.stringValue ?? ''
    );
  });
}

function parseCopyRowsData(
  copyRowsData,
  localesJsObject,
  sheetLocales,
  sheetName
) {
  copyRowsData.forEach((copyRowData) => {
    const isEmptyRow = copyRowData.values === undefined;
    if (isEmptyRow) return;

    const copyRowDataNeedsCorrection =
      copyRowData.values.length !== sheetLocales.length + 1;
    const _copyRowData = {
      values: copyRowDataNeedsCorrection
        ? createInitializedArrayOfLengthFromArray(
            sheetLocales.length + 1,
            copyRowData.values
          )
        : copyRowData.values,
    };

    parseCopyRowData(_copyRowData, sheetLocales, localesJsObject, sheetName);
  });
}

function createSheetEntryToLocalesJsObject(
  localesJsObject,
  sheetLocales,
  sheetName
) {
  sheetLocales.forEach((sheetLocale) => {
    localesJsObject[sheetLocale] ||= {};
    localesJsObject[sheetLocale][sheetName] = {};
  });
}

function parseCurrentSheetLocales(localesRowData) {
  return [
    ...localesRowData.values.map((value) => value.effectiveValue.stringValue),
  ];
}

function parseLocalesRowData(localesRowData, sheetLocales) {
  parseCurrentSheetLocales(localesRowData)
    .slice(1)
    .forEach((sheetLocale) => {
      sheetLocales.push(sheetLocale);
    });
}

function writeToLocaleFiles(localesJsObject) {
  Object.keys(localesJsObject).forEach((locale) => {
    const localeObject = localesJsObject[locale];

    if (!fs.existsSync(`${outputDirectory}`)) {
      fs.mkdirSync(`${outputDirectory}`, { recursive: true });
    }

    fs.writeFile(
      `${outputDirectory}/${locale}.json`,
      JSON.stringify(localeObject, null, 2),
      (error) => {
        if (error) {
          console.error(`Error writing ${locale}.json file:`, error);
        } else {
          console.log(`${locale}.json file saved successfully.`);
        }
      }
    );
  });
}

function createLocalesJsObject(sheets) {
  return sheets.reduce((localesJsObject, sheet) => {
    const sheetHasData = sheet.data[0].rowData !== undefined;

    if (sheetHasData) {
      const sheetName = lowercaseFirstLetter(sheet.properties.title);
      const sheetLocales = [];
      const localesRowData = sheet.data[0].rowData[0];
      const copyRowsData = sheet.data[0].rowData.slice(1);

      parseLocalesRowData(localesRowData, sheetLocales);
      createSheetEntryToLocalesJsObject(
        localesJsObject,
        sheetLocales,
        sheetName
      );
      parseCopyRowsData(copyRowsData, localesJsObject, sheetLocales, sheetName);
    }

    return localesJsObject;
  }, {});
}

async function fetchGoogleSpreadsheetSheets() {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    key: apiKey,
    fields: 'sheets(properties.title,data.rowData.values(effectiveValue))',
  });

  return spreadsheet.data.sheets;
}

async function fetchLocales() {
  const sheets = await fetchGoogleSpreadsheetSheets();
  const localesJsObject = createLocalesJsObject(sheets);
  writeToLocaleFiles(localesJsObject);
}

(async () => {
  try {
    await fetchLocales();
  } catch (error) {
    console.error(error);
  }
})();
