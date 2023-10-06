#!/usr/bin/perl

use strict;
use warnings;
use File::Find;

my $name = $ARGV[0];
my ($gitTag, $version, $preview);

# Subroutine to apply on each file
sub wanted {
    return unless -f; # Skip directories
    return unless /$name\.((\d+\.\d+\.\d+)(\-[a-zA-Z0-9\-\.]+)?)\.nupkg$/;

    $gitTag = $1;
    $version = $2;
    $preview = $3 || '';  # Default to empty string if undefined
    $File::Find::prune = 1; # Stop searching further
}

# Perform a search
find(\&wanted, '.');

# Check if version information was found
if (not defined $gitTag or not defined $version) {
    die "Could not find version information";
}

# Open GitHub output file for appending
open my $fh, '>>', $ENV{'GITHUB_OUTPUT'} or die "Could not open GitHub output file: $!";

# Set is-preview and release-display-name
if ($preview eq "") {
    print $fh "is-preview=false\n";
    print $fh "release-display-name=$version\n";
} elsif ($preview =~ m/alpha/) {
    print $fh "is-preview=true\n";
    print $fh "release-display-name=$version - Alpha\n";
} elsif ($preview =~ m/beta/) {
    print $fh "is-preview=true\n";
    print $fh "release-display-name=$version - Beta\n";
} else {
    print $fh "is-preview=true\n";
    print $fh "release-display-name=$version - Preview\n";
}

# Set version-name
print $fh "version-name=$gitTag\n";

# Close the file handle
close $fh;
