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

# Helper to write and print output
sub write_and_print {
    my ($key, $value) = @_;
    print $fh "$key=$value\n";
    print "$key=$value\n";
}

# Set is-preview and release-display-name
if ($preview eq "") {
    write_and_print("is-preview", "false");
    write_and_print("release-display-name", $version);
} elsif ($preview =~ m/alpha/) {
    write_and_print("is-preview", "true");
    write_and_print("release-display-name", "$version - Alpha");
} elsif ($preview =~ m/beta/) {
    write_and_print("is-preview", "true");
    write_and_print("release-display-name", "$version - Beta");
} else {
    write_and_print("is-preview", "true");
    write_and_print("release-display-name", "$version - Preview");
}

# Set version-name
write_and_print("version-name", $gitTag);

# Close the file handle
close $fh;
