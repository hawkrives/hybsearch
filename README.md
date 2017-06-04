## To install

- install homebrew: `<https://brew.sh>`
- install node: `brew install node`
- install things: `brew install homebrew/science/beagle --with-opencl`
- install openmpi: `brew install open-mpi`


pipeline:

```shell
cat data/emydura-short.gb \
	| ./bin/genbank-fasta.js - \
	| ./bin/clustal-o.js - \
	| ./bin/fasta-to-nexus.js - \
	| ./bin/mrbayes.js - \
	| ./bin/consensus-newick.js - \
	| ./bin/newick-json.js - \
	| ./ent.js -
```

to convert files:

```shell
./vendor/seqmagick/cli.py convert --input-format fasta --output-format nexus --alphabet dna <input> <output>
```


## How to update Electron:

- `npm install -g electron-download`
- `electron-download --version=<version>`
- Copy the zip from `~/.electron` and extract it into `hybsearch/vendor`
- Edit the `hybsearch` file to point to the new path
- Remove the old folder


```
>>> hamming-distance speciesA speciesB
$minimumDistance
>>> estimate-generations $minimumDistance
{divergenceTime, generationCount}
>>> seq-gen $file --generations $generationCount
$sequences > sequences.fasta
>>> hamdis sequences.fasta
???
```
