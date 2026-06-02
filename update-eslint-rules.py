import requests
import re
import os

# ---- TEMPORARY BRANCH SELECTOR (remove after p5.js 2.0 release) ----
# Toggle this value between 'main' and '2.0'.
P5JS_REFERENCE_BRANCH = '2.0'

# URL of the p5.js reference JSON file
p5js_reference_url = (
    f'https://raw.githubusercontent.com/processing/p5.js-website/refs/heads/'
    f'{P5JS_REFERENCE_BRANCH}/public/reference/data.json'
)
# ---- END TEMPORARY BRANCH SELECTOR ----

#old URL -- before selector added
# p5js_reference_url = 'https://raw.githubusercontent.com/processing/p5.js-website/refs/heads/main/public/reference/data.json'


# Path to the eslint.config.mjs file
eslint_config_path = os.path.join(os.path.dirname(__file__), 'template/eslint.config.mjs')

# Fetch the p5.js reference JSON file
response = requests.get(p5js_reference_url)
if response.status_code != 200:
    print(f'Error fetching p5.js reference JSON: {response.status_code}')
    exit(1)

# Parse the JSON data
reference_data = response.json()

# Extract global variables and functions from the reference JSON
global_vars = set()

# The p5.js website reference is an object with a `classitems` array in both
# `main` and `2.0`. Keep a fallback for any legacy array-shaped payloads.
if isinstance(reference_data, dict):
    reference_entries = reference_data.get('classitems', [])
elif isinstance(reference_data, list):
    reference_entries = reference_data
else:
    reference_entries = []

for entry in reference_entries:
    if isinstance(entry, dict):
        name = entry.get('name')
        if isinstance(name, str):
            global_vars.add(name)

# Read the eslint.config.mjs file
with open(eslint_config_path, 'r', encoding='utf-8') as file:
    content = file.read()

# Extract existing globals and current indentation style for the block
globals_match = re.search(r'(?P<indent>^[ \t]*)globals:\s*{(?P<body>[^}]*)}', content, re.DOTALL | re.MULTILINE)
if globals_match:
    existing_globals = globals_match.group('body')
    existing_globals = set(re.findall(r'(\w+):\s*"readonly"', existing_globals))
    block_indent = globals_match.group('indent')
else:
    existing_globals = set()
    block_indent = '      '

# Merge existing globals with new globals
merged_globals = existing_globals.union(global_vars)
merged_globals_list = sorted(merged_globals)

# Create new globals section
entry_indent = f'{block_indent}  '
new_globals_section = (
    f'{block_indent}globals: {{\n'
    + ',\n'.join([f'{entry_indent}{var_name}: "readonly"' for var_name in merged_globals_list])
    + f'\n{block_indent}}}'
)

# Update the globals section in the eslint.config.mjs file
globals_section_regex = re.compile(r'^[ \t]*globals:\s*{[^}]*}', re.DOTALL | re.MULTILINE)
updated_content = globals_section_regex.sub(new_globals_section, content)

if updated_content == content:
    print('No eslint globals changes detected.')
else:
    # Write the updated content back to the eslint.config.mjs file
    with open(eslint_config_path, 'w', encoding='utf-8') as file:
        file.write(updated_content)

    print('eslint.config.mjs file updated successfully.')